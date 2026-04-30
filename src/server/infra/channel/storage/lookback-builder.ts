import type {
  ChannelMember,
  ChannelMeta,
  LookbackPacket,
  Turn,
} from '../../../core/domain/channel/types.js'
import type {DigestRef, TreeReader} from './tree-reader.js'

import {isTerminalState} from '../../../core/domain/channel/state-machine.js'

type LookbackEntry = LookbackPacket['sinceYourLastTurn'][number]
type SharedArtifact = LookbackPacket['sharedArtifacts'][number]

const DEFAULT_MAX_BYTES = 32_000

/**
 * Builds the channel state diff that the orchestrator hands to a driver
 * before each turn (§3.6 of the design).
 *
 * Per Q7's third-pass review note: because `lastCompletedTurnFor()` is the
 * lookback floor, the *original* framing prompt for an agent falls out of
 * subsequent lookbacks once that agent has spoken. v1 users handle this by
 * re-framing each mention; v1.1's `ChannelMeta.topic` (when added) is
 * injected here as a `[Channel context: …]` prefix on `currentPrompt`.
 *
 * Per Q6: when a digest covers the lookback window, the digest is spliced
 * into `sinceYourLastTurn` as a single `kind: 'digest'` entry replacing the
 * individual turns it summarises.
 */
export class LookbackBuilder {
  constructor(
    private readonly reader: TreeReader,
    private readonly maxBytes: number = DEFAULT_MAX_BYTES,
  ) {}

  public async build(meta: ChannelMeta, member: ChannelMember, currentPrompt: string): Promise<LookbackPacket> {
    const yourLastTurn = await this.reader.lastCompletedTurnFor(meta, member.agentId)
    const since = await this.reader.turnsAfter(meta, yourLastTurn?.endedAt ?? meta.createdAt)
    // Filter to terminal-state turns only — `turnsAfter()` accepts in-flight turns via
    // their `startedAt` fallback, but lookbacks must show only settled work or agents
    // would see each other's mid-stream thoughts (Phase 1 review note 6.1).
    const sinceFromOthers = since.filter(
      (turn) => turn.agentId !== member.agentId && isTerminalState(turn.state),
    )

    const digests = await this.reader.listDigests(meta)
    const latestDigest = digests[0]

    const {contributingTurns, entries} = applyDigestSplice(sinceFromOthers, latestDigest, yourLastTurn)
    const sharedArtifacts = uniqueArtifacts(contributingTurns)

    const packet: LookbackPacket = {
      channelId: meta.channelId,
      currentPrompt,
      sharedArtifacts,
      sinceYourLastTurn: entries,
      yourLastTurn: yourLastTurn ?? null,
    }

    return enforceByteBudget(packet, this.maxBytes)
  }
}

/** Project a `Turn` into a `LookbackPacket.sinceYourLastTurn` entry. */
export function toLookbackEntry(turn: Turn): LookbackEntry {
  const touched = turn.artifactsTouched ?? []
  if (touched.length > 0) {
    return {
      by: `@${turn.agentId}`,
      kind: 'artifact',
      path: touched[0],
      summary: `${turn.agentId} wrote ${touched.length} artifact${touched.length === 1 ? '' : 's'}.`,
      turnId: turn.turnId,
    }
  }

  return {
    by: `@${turn.agentId}`,
    kind: 'message',
    path: null,
    summary: turn.promptText.length > 200 ? turn.promptText.slice(0, 200) + '…' : turn.promptText,
    turnId: turn.turnId,
  }
}

/** Deduplicate artifact paths from a turn list, projecting to LookbackPacket.sharedArtifacts. */
export function uniqueArtifacts(turns: Turn[]): SharedArtifact[] {
  const counts = new Map<string, number>()
  for (const turn of turns) {
    for (const path of turn.artifactsTouched ?? []) {
      counts.set(path, (counts.get(path) ?? 0) + 1)
    }
  }

  return [...counts.entries()].map(([path, version]) => ({
    factId: path,
    path,
    version,
  }))
}

/**
 * Truncate `sinceYourLastTurn` summaries until the JSON-serialised packet
 * is within `maxBytes`. Truncation halves the longest summary on each pass;
 * floors at 20 characters to keep something useful.
 */
export function enforceByteBudget(packet: LookbackPacket, maxBytes: number): LookbackPacket {
  let serialised = JSON.stringify(packet)
  if (serialised.length <= maxBytes) {
    return packet
  }

  const entries = packet.sinceYourLastTurn.map((entry) => ({...entry}))
  const result: LookbackPacket = {...packet, sinceYourLastTurn: entries}

  while (serialised.length > maxBytes) {
    let longest: LookbackEntry | undefined
    for (const entry of entries) {
      if (longest === undefined || entry.summary.length > longest.summary.length) {
        longest = entry
      }
    }

    if (!longest || longest.summary.length <= 20) break

    longest.summary = longest.summary.slice(0, Math.floor(longest.summary.length / 2)) + '…'
    serialised = JSON.stringify(result)
  }

  return result
}

/**
 * Q6 — when a digest covers the lookback window, replace covered turns with
 * a single `kind: 'digest'` entry. Returns the projected entry list and the
 * subset of `since` turns that actually contributed (used for shared-artifact
 * derivation; covered turns drop out).
 */
function applyDigestSplice(
  since: Turn[],
  latestDigest: DigestRef | undefined,
  yourLastTurn: null | Turn,
): {contributingTurns: Turn[]; entries: LookbackEntry[]} {
  if (!latestDigest) {
    return {contributingTurns: since, entries: since.map((turn) => toLookbackEntry(turn))}
  }

  // NOTE: lexicographic comparison on turn IDs (e.g. `t-013 >= t-008`) only works because
  // turn IDs are zero-padded by `formatTurnId()` in `tree-writer.ts`. If the padding width
  // ever changes (e.g. t-1 → t-001), revisit this comparison or switch to a numeric parse.
  const covers = !yourLastTurn || latestDigest.coversThrough >= yourLastTurn.turnId
  if (!covers) {
    return {contributingTurns: since, entries: since.map((turn) => toLookbackEntry(turn))}
  }

  const covered = new Set(latestDigest.sourceTurnIds)
  const remaining = since.filter((turn) => !covered.has(turn.turnId))
  const digestEntry: LookbackEntry = {
    by: '@system',
    kind: 'digest',
    path: `channel/${latestDigest.id}.md`,
    summary: latestDigest.summary,
    turnId: latestDigest.id,
  }

  return {
    contributingTurns: remaining,
    entries: [digestEntry, ...remaining.map((turn) => toLookbackEntry(turn))],
  }
}
