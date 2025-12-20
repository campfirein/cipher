import type {ICipherAgent} from '../cipher/i-cipher-agent.js'

/**
 * Options for executing curate with an injected agent (v0.5.0 architecture).
 * Agent uses its default session (Single-Session pattern).
 */
export interface CurateExecuteOptionsV2 {
  /** Context content to curate */
  content: string
  /** Optional file paths for --files flag */
  files?: string[]
}

/**
 * ICurateUseCaseV2 - Simplified curate use case for v0.5.0 architecture.
 *
 * Key differences from v1:
 * - Only executeWithAgent method (no run() for REPL mode)
 * - No terminal/tracking dependencies (handled by caller)
 * - Pure business logic execution
 *
 * This interface is designed for Transport-based task execution where:
 * - TaskProcessor injects the long-lived CipherAgent
 * - Event streaming is handled by agent-worker (subscribes to agentEventBus)
 * - UseCase focuses solely on curate business logic
 */
export interface ICurateUseCaseV2 {
  /**
   * Execute curate with an injected agent.
   *
   * @param agent - Long-lived CipherAgent (managed by caller)
   * @param options - Execution options (content, file references)
   * @returns Result string from agent execution
   */
  executeWithAgent(agent: ICipherAgent, options: CurateExecuteOptionsV2): Promise<string>
}
