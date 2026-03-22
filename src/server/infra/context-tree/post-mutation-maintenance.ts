/**
 * Shared post-mutation maintenance for the context tree.
 *
 * After any tree mutation (curation, reorg), summaries (_index.md) and
 * manifest (_manifest.json) may be stale. This function propagates
 * staleness markers and opportunistically rebuilds the manifest.
 *
 * Used by both CurateExecutor and ReorgExecutor.
 */

import type {ICipherAgent} from '../../../agent/core/interfaces/i-cipher-agent.js'
import type {FileState} from '../../core/domain/entities/context-tree-snapshot.js'

import {FileContextTreeManifestService} from './file-context-tree-manifest-service.js'
import {FileContextTreeSnapshotService} from './file-context-tree-snapshot-service.js'
import {FileContextTreeSummaryService} from './file-context-tree-summary-service.js'
import {diffStates} from './snapshot-diff.js'

/**
 * Capture pre-mutation state for later diff.
 * Returns the snapshot, or undefined if capture fails (fail-open).
 */
export async function capturePreState(
  baseDir: string,
): Promise<Map<string, FileState> | undefined> {
  try {
    const snapshotService = new FileContextTreeSnapshotService({baseDirectory: baseDir})

    return await snapshotService.getCurrentState(baseDir)
  } catch {
    // Fail-open: if snapshot fails, skip summary propagation

    return undefined
  }
}

/**
 * Run post-mutation maintenance: propagate staleness + rebuild manifest.
 *
 * Compares pre-state with current state, marks changed summaries as stale,
 * and opportunistically rebuilds the manifest for next query.
 *
 * Fail-open: errors never propagate to caller.
 *
 * @param preState - Pre-mutation snapshot (from capturePreState)
 * @param agent - CipherAgent for summary regeneration
 * @param baseDir - Project base directory
 */
export async function postTreeMutationMaintenance(
  preState: Map<string, FileState> | undefined,
  agent: ICipherAgent,
  baseDir: string,
): Promise<void> {
  if (!preState) return

  try {
    const snapshotService = new FileContextTreeSnapshotService({baseDirectory: baseDir})
    const postState = await snapshotService.getCurrentState(baseDir)
    const changedPaths = diffStates(preState, postState)

    if (changedPaths.length > 0) {
      const summaryService = new FileContextTreeSummaryService()
      const results = await summaryService.propagateStaleness(changedPaths, agent, baseDir)

      // Opportunistic manifest rebuild (pre-warm for next query)
      if (results.some((r) => r.actionTaken)) {
        const manifestService = new FileContextTreeManifestService({baseDirectory: baseDir})
        await manifestService.buildManifest(baseDir)
      }
    }
  } catch {
    // Fail-open: summary/manifest errors never block operations
  }
}
