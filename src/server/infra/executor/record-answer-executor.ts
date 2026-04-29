/**
 * RecordAnswerExecutor (Phase 5 Task 5.4) — daemon-side handler for
 * `brv_record_answer` MCP tool and `brv record-answer` CLI command.
 *
 * Closes the cache loop: agent calls this AFTER synthesizing from a
 * `brv_gather` bundle, so future equivalent queries hit tier 0/1 via
 * `brv_search` / `brv_query` without re-paying for synthesis.
 *
 * Failure modes are graceful — when no cache is configured (daemon
 * started without it) or `cache.set` throws, returns `recorded: false`
 * instead of erroring. Skill/hook agents shouldn't blow up just because
 * cache is disabled or full.
 */

import type {
  IRecordAnswerExecutor,
  RecordAnswerOptions,
  RecordAnswerResult,
} from '../../core/interfaces/executor/i-record-answer-executor.js'
import type {QueryResultCache} from './query-result-cache.js'

export interface RecordAnswerExecutorDeps {
  cache?: QueryResultCache
}

export class RecordAnswerExecutor implements IRecordAnswerExecutor {
  private readonly cache?: QueryResultCache

  constructor(deps: RecordAnswerExecutorDeps) {
    this.cache = deps.cache
  }

  async execute(options: RecordAnswerOptions): Promise<RecordAnswerResult> {
    if (!this.cache) {
      return {fingerprint: options.fingerprint, recorded: false}
    }

    try {
      this.cache.set(options.query, options.answer, options.fingerprint)
      return {fingerprint: options.fingerprint, recorded: true}
    } catch {
      return {fingerprint: options.fingerprint, recorded: false}
    }
  }
}
