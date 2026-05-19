/**
 * Tool-mode dream session manager — orchestrates scan + finalize.
 *
 * `scanDreamCandidates` loads every topic in the context tree, runs the
 * requested per-kind candidate generators in parallel, and returns a
 * unified envelope keyed by kind. The calling agent then decides what to
 * do per candidate (link via brv-curate UPDATE, merge via brv-curate
 * MERGE, etc.) and finally calls `finalizeDreamSession` with the loser
 * paths to archive.
 *
 * The session id is opaque — a uuid the agent passes through scan →
 * finalize so future versions can persist per-session state for resume
 * support. v1 doesn't persist it; the session is effectively stateless on
 * the daemon side.
 */

import {randomUUID} from 'node:crypto'
import {existsSync} from 'node:fs'
import {mkdir, rename} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import type {ISearchKnowledgeService} from '../../../../agent/infra/sandbox/tools-sdk.js'
import type {IRuntimeSignalStore} from '../../../core/interfaces/storage/i-runtime-signal-store.js'

import {findLinkCandidates, type LinkCandidate} from './link-candidates.js'
import {findMergeCandidates, type MergeCandidate} from './merge-candidates.js'
import {findPruneCandidates, type PruneCandidate} from './prune-candidates.js'
import {findSynthesizeCandidates, type SynthesizeCandidates} from './synthesize-candidates.js'
import {loadToolModeTopics} from './topic-loader.js'

export type DreamKind = 'link' | 'merge' | 'prune' | 'synthesize'

export const ALL_DREAM_KINDS: readonly DreamKind[] = ['link', 'merge', 'prune', 'synthesize']

/** Tool-mode dream archive lives under `.brv/archive/` so undo can find it. */
const ARCHIVE_SUBDIR = 'archive'

export type DreamScanInput = {
  contextTreeRoot: string
  options?: {
    /** Default: all four. */
    kinds?: DreamKind[]
    maxCandidates?: number
    scope?: string
  }
  runtimeSignalStore: IRuntimeSignalStore
  searchService: ISearchKnowledgeService
}

export type DreamCandidateBundle = {
  link: LinkCandidate[]
  merge: MergeCandidate[]
  prune: PruneCandidate[]
  synthesize: SynthesizeCandidates
}

export type DreamScanResult = {
  candidates: DreamCandidateBundle
  sessionId: string
}

/**
 * Load topics + run all requested candidate generators in parallel.
 *
 * Returns one envelope with four keys — each key is empty when its kind
 * isn't requested via `options.kinds`. Empty kinds keep the shape stable
 * for the CLI / agent consumer.
 */
export async function scanDreamCandidates(input: DreamScanInput): Promise<DreamScanResult> {
  const {contextTreeRoot, options, runtimeSignalStore, searchService} = input
  const requestedKinds = new Set<DreamKind>(options?.kinds ?? ALL_DREAM_KINDS)

  const topics = await loadToolModeTopics({contextTreeRoot, runtimeSignalStore})

  const empty: DreamCandidateBundle = {link: [], merge: [], prune: [], synthesize: {domains: [], existingSyntheses: []}}

  const [link, merge, prune, synthesize] = await Promise.all([
    requestedKinds.has('link')
      ? findLinkCandidates({
          options: {maxCandidates: options?.maxCandidates, scope: options?.scope},
          searchService,
          topics: topics.map((t) => ({
            alreadyLinkedTo: t.related,
            html: t.html,
            path: t.path,
            summary: t.summary,
            title: t.title,
          })),
        })
      : Promise.resolve(empty.link),
    requestedKinds.has('merge')
      ? findMergeCandidates({
          options: {maxCandidates: options?.maxCandidates, scope: options?.scope},
          searchService,
          topics: topics.map((t) => ({html: t.html, path: t.path, summary: t.summary, title: t.title})),
        })
      : Promise.resolve(empty.merge),
    requestedKinds.has('prune')
      ? findPruneCandidates({
          options: {maxCandidates: options?.maxCandidates, scope: options?.scope},
          topics: topics.map((t) => ({html: t.html, mtimeMs: t.mtimeMs, path: t.path, signals: t.signals})),
        })
      : Promise.resolve(empty.prune),
    requestedKinds.has('synthesize')
      ? findSynthesizeCandidates({
          options: {scope: options?.scope},
          topics: topics.map((t) => ({path: t.path, summary: t.summary, title: t.title})),
        })
      : Promise.resolve(empty.synthesize),
  ])

  return {
    candidates: {link, merge, prune, synthesize},
    sessionId: randomUUID(),
  }
}

export type DreamFinalizeInput = {
  /** Relative paths under .brv/context-tree/ to archive. */
  archive: string[]
  /** Absolute path to `.brv` (parent of `context-tree/` and `archive/`). */
  brvDir: string
  contextTreeRoot: string
  runtimeSignalStore: IRuntimeSignalStore
  /** Opaque session id; v1 doesn't persist sessions but downstream tooling may track it. */
  sessionId: string
}

export type DreamFinalizeSkipped = {
  path: string
  reason: 'not-found' | 'rename-failed'
}

export type DreamFinalizeResult = {
  archived: string[]
  /** Files that weren't archived, with a coarse reason for each. */
  skipped: DreamFinalizeSkipped[]
}

/**
 * Move each named topic from `.brv/context-tree/<path>` to
 * `.brv/archive/<path>`, preserving the relative directory structure.
 * Drops the sidecar entry on success. Skips (rather than throws) when a
 * named path is missing or unreadable so partial failure is recoverable
 * via re-scan.
 */
export async function finalizeDreamSession(input: DreamFinalizeInput): Promise<DreamFinalizeResult> {
  const {archive, brvDir, contextTreeRoot, runtimeSignalStore} = input
  const archiveRoot = join(brvDir, ARCHIVE_SUBDIR)

  const outcomes = await Promise.all(
    archive.map(async (relPath): Promise<{path: string; reason: DreamFinalizeSkipped['reason']; result: 'skipped'} | {path: string; result: 'archived'}> => {
      const source = join(contextTreeRoot, relPath)
      if (!existsSync(source)) return {path: relPath, reason: 'not-found', result: 'skipped'}

      const target = join(archiveRoot, relPath)
      try {
        await mkdir(dirname(target), {recursive: true})
        await rename(source, target)
      } catch {
        return {path: relPath, reason: 'rename-failed', result: 'skipped'}
      }

      try {
        await runtimeSignalStore.delete(relPath)
      } catch {
        // best-effort sidecar cleanup; the topic is already archived
      }

      return {path: relPath, result: 'archived'}
    }),
  )

  const archived: string[] = []
  const skipped: DreamFinalizeSkipped[] = []
  for (const outcome of outcomes) {
    if (outcome.result === 'archived') archived.push(outcome.path)
    else skipped.push({path: outcome.path, reason: outcome.reason})
  }

  return {archived, skipped}
}
