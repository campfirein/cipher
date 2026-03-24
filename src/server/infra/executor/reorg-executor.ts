/**
 * Top-level executor for context tree reorganisation (merge / move).
 *
 * Wraps the full transaction lifecycle:
 * 1. Capture pre-state snapshot
 * 2. Detect and validate candidates via ReorgHarnessService
 * 3. Execute validated operations inside a ContextTreeTransaction
 * 4. Run post-mutation maintenance (summaries + manifest)
 * 5. Record harness feedback and trigger async refinement
 */

import type {ICipherAgent} from '../../../agent/core/interfaces/i-cipher-agent.js'
import type {
  IReorgExecutor,
  ReorgExecutionSummary,
  ReorgResult,
} from '../../core/interfaces/executor/i-reorg-executor.js'
import type {ReorgHarnessService} from '../harness/reorg/reorg-harness-service.js'

import {ContextTreeTransaction} from '../context-tree/context-tree-transaction.js'
import {capturePreState, postTreeMutationMaintenance} from '../context-tree/post-mutation-maintenance.js'
import {ReorgOperationExecutor} from '../harness/reorg/reorg-operation-executor.js'

// ── Types ───────────────────────────────────────────────────────────────────

export interface ReorgExecutorDeps {
  harnessService: ReorgHarnessService
}

// ── Executor ────────────────────────────────────────────────────────────────

export class ReorgExecutor implements IReorgExecutor {
  private readonly harnessService: ReorgHarnessService

  public constructor(deps: ReorgExecutorDeps) {
    this.harnessService = deps.harnessService
  }

  async detectAndExecute(params: {
    agent: ICipherAgent
    contextTreeDir: string
    dryRun?: boolean
    projectBaseDir: string
  }): Promise<ReorgExecutionSummary> {
    const {agent, contextTreeDir, dryRun, projectBaseDir} = params

    // 1. Capture pre-state for post-mutation diff
    const preState = await capturePreState(projectBaseDir)

    // 2. Detect and validate candidates
    const {candidates, selection, validated} = await this.harnessService.detectAndValidate({contextTreeDir})

    // Dry-run: return summary without executing
    if (dryRun) {
      return {
        candidatesDetected: candidates.length,
        candidatesExecuted: 0,
        candidatesSkipped: candidates.length - validated.length,
        results: [],
        templateNodeId: selection?.node.id,
      }
    }

    // Nothing to execute
    if (validated.length === 0) {
      return {
        candidatesDetected: candidates.length,
        candidatesExecuted: 0,
        candidatesSkipped: candidates.length - validated.length,
        results: [],
        templateNodeId: selection?.node.id,
      }
    }

    // 3. Begin transaction
    const transaction = new ContextTreeTransaction({contextTreeDir})
    await transaction.begin()

    // 4. Execute each validated candidate
    const operationExecutor = new ReorgOperationExecutor({contextTreeDir})
    const results: ReorgResult[] = []
    let hasCriticalFailure = false

    for (const candidate of validated) {
      // Sequential execution is intentional — each operation may depend on the
      // previous one's filesystem changes (e.g. relation rewrites).
      const result = await operationExecutor.execute(candidate) // eslint-disable-line no-await-in-loop
      results.push(result)

      if (!result.success) {
        // Treat any failure as critical — rollback the entire batch
        hasCriticalFailure = true

        break
      }
    }

    // 5. Rollback on critical failure
    if (hasCriticalFailure) {
      await transaction.rollback()
      const failedResult = results.find((r) => !r.success)
      throw new Error(
        `Reorg rolled back due to critical failure: ${failedResult?.error ?? 'unknown error'}. ` +
        'Use --dry-run to preview candidates before executing.',
      )
    }

    // 6. Commit transaction
    await transaction.commit()

    // 7. Post-mutation maintenance (summaries + manifest)
    await postTreeMutationMaintenance(preState, agent, projectBaseDir)

    // 8. Record feedback (awaited)
    const nodeId = selection?.node.id
    if (nodeId) {
      await this.harnessService.recordFeedback(nodeId, results)

      // 9. Async refinement (fire-and-forget)
      this.harnessService.refineIfNeeded(nodeId).catch(() => {})
    }

    // 10. Return summary
    const successCount = results.filter((r) => r.success).length

    return {
      candidatesDetected: candidates.length,
      candidatesExecuted: successCount,
      candidatesSkipped: candidates.length - validated.length,
      results,
      templateNodeId: nodeId,
    }
  }
}
