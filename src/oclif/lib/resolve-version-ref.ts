/**
 * AutoHarness V2 — shared version-ref resolver.
 *
 * Implements the grammar defined in
 * `features/autoharness-v2/tasks/phase_7_8_handoff.md §C3`:
 *
 *   - 'latest'    → most-recently-written version (by `version` number)
 *   - 'best'      → highest-H version; ties broken by newest `createdAt`
 *   - 'v<N>'      → version whose integer `version` field equals N
 *   - '<raw-id>'  → direct id lookup
 *
 * Used by `brv harness inspect` / `use` / `diff` / `reset` so the
 * grammar lives in exactly one place — a new ref type lights up
 * everywhere the moment it's added here.
 */

import type {HarnessVersion} from '../../agent/core/domain/harness/types.js'
import type {IHarnessStore} from '../../agent/core/interfaces/i-harness-store.js'

export interface VersionRefResolution {
  readonly version: HarnessVersion
  readonly versionId: string
}

export type VersionRefErrorCode = 'INVALID_GRAMMAR' | 'NO_VERSIONS' | 'NOT_FOUND'

export class VersionRefError extends Error {
  constructor(
    message: string,
    public readonly code: VersionRefErrorCode,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = 'VersionRefError'
  }
}

/**
 * `v<N>` where the regex matches any `\d+` (including `0`), then the
 * resolver rejects `N <= 0` explicitly so the error message is clearer
 * than a silent "not found". `v-1` and `v1.5` never match the regex.
 */
const V_N_PATTERN = /^v(\d+)$/

/**
 * Resolve a version-ref to the concrete `HarnessVersion` for a pair.
 *
 * @throws {VersionRefError} with code `NOT_FOUND` when the ref is
 *   well-formed but no matching version exists, `NO_VERSIONS` when
 *   the pair has no versions at all (only for `latest`/`best`).
 *   Raw-id misses surface as `NOT_FOUND`.
 */
export async function resolveVersionRef(
  ref: string,
  projectId: string,
  commandType: string,
  store: IHarnessStore,
): Promise<VersionRefResolution> {
  if (ref === 'latest') {
    const latest = await store.getLatest(projectId, commandType)
    if (latest === undefined) {
      throw new VersionRefError(
        `no versions stored for (${projectId}, ${commandType}) — run curate once to bootstrap.`,
        'NO_VERSIONS',
        {commandType, projectId, ref},
      )
    }

    return {version: latest, versionId: latest.id}
  }

  if (ref === 'best') {
    const versions = await store.listVersions(projectId, commandType)
    if (versions.length === 0) {
      throw new VersionRefError(
        `no versions stored for (${projectId}, ${commandType}) — run curate once to bootstrap.`,
        'NO_VERSIONS',
        {commandType, projectId, ref},
      )
    }

    // Max heuristic; tie-break on newest createdAt per §C3.
    let best = versions[0]
    for (let i = 1; i < versions.length; i++) {
      const v = versions[i]
      if (v.heuristic > best.heuristic) best = v
      else if (v.heuristic === best.heuristic && v.createdAt > best.createdAt) best = v
    }

    return {version: best, versionId: best.id}
  }

  const vNMatch = V_N_PATTERN.exec(ref)
  if (vNMatch !== null) {
    const n = Number.parseInt(vNMatch[1], 10)
    if (n <= 0) {
      throw new VersionRefError(
        `invalid v<N> ref '${ref}' — N must be a positive integer (1-indexed).`,
        'INVALID_GRAMMAR',
        {ref},
      )
    }

    const versions = await store.listVersions(projectId, commandType)
    const match = versions.find((v) => v.version === n)
    if (match === undefined) {
      throw new VersionRefError(
        `no version #${n} for (${projectId}, ${commandType}). Available: ${versions.map((v) => `#${v.version}`).join(', ') || 'none'}.`,
        'NOT_FOUND',
        {available: versions.map((v) => v.version), commandType, projectId, ref, requested: n},
      )
    }

    return {version: match, versionId: match.id}
  }

  // Fallback: raw id lookup.
  const version = await store.getVersion(projectId, commandType, ref)
  if (version === undefined) {
    throw new VersionRefError(
      `version '${ref}' not found for (${projectId}, ${commandType}).`,
      'NOT_FOUND',
      {commandType, projectId, ref},
    )
  }

  return {version, versionId: version.id}
}
