import path from 'node:path'

import type {ICipherAgent} from '../../../agent/core/interfaces/i-cipher-agent.js'
import type {FileState} from '../../core/domain/entities/context-tree-snapshot.js'
import type {FileContextTreeSnapshotService} from './file-context-tree-snapshot-service.js'

import {BRV_DIR} from '../../constants.js'
import {DreamLockService} from '../dream/dream-lock-service.js'
import {FileContextTreeManifestService} from './file-context-tree-manifest-service.js'
import {FileContextTreeSummaryService} from './file-context-tree-summary-service.js'
import {diffStates} from './snapshot-diff.js'

export type PropagateSummariesUnderLockOptions = {
  agent: ICipherAgent
  baseDir: string
  preState: Map<string, FileState> | undefined
  snapshotService: FileContextTreeSnapshotService
  taskId: string
}

/**
 * Phase 4 write block shared by curate and folder-pack post-work: snapshot
 * diff → `propagateStaleness` → opportunistic manifest rebuild. Holds the
 * dream lock around the writes so a concurrent dream cannot interleave on
 * `_index.md` / `_manifest.json`; if the lock is held, this skips because
 * dream's own propagation covers the same diff. Fail-open.
 */
export async function propagateSummariesUnderLock(
  options: PropagateSummariesUnderLockOptions,
): Promise<void> {
  const {agent, baseDir, preState, snapshotService, taskId} = options
  if (!preState) return

  const dreamLockService = new DreamLockService({baseDir: path.join(baseDir, BRV_DIR)})
  let acquireResult: Awaited<ReturnType<DreamLockService['tryAcquire']>>
  try {
    acquireResult = await dreamLockService.tryAcquire()
  } catch {
    return
  }

  if (!acquireResult.acquired) return

  let succeeded = false
  try {
    const postState = await snapshotService.getCurrentState(baseDir)
    const changedPaths = diffStates(preState, postState)
    if (changedPaths.length === 0) {
      succeeded = true
      return
    }

    const summaryService = new FileContextTreeSummaryService()
    const results = await summaryService.propagateStaleness(changedPaths, agent, baseDir, taskId)
    if (results.some((result) => result.actionTaken)) {
      const manifestService = new FileContextTreeManifestService({baseDirectory: baseDir})
      await manifestService.buildManifest(baseDir)
    }

    succeeded = true
  } catch {
    // Fail-open: summary/manifest errors never block the caller.
  } finally {
    await (succeeded
      ? dreamLockService.release()
      : dreamLockService.rollback(acquireResult.priorMtime)
    ).catch(() => {})
  }
}
