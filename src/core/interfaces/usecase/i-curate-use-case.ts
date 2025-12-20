import type {ICipherAgent} from '../cipher/i-cipher-agent.js'

/**
 * Options for REPL-style execution (with terminal output).
 */
export interface CurateUseCaseRunOptions {
  apiKey?: string
  context?: string
  files?: string[]
  model?: string
  verbose?: boolean
}

/**
 * Options for executing with an injected agent (v0.5.0 architecture).
 * Agent uses its default session (Single-Session pattern).
 */
export interface CurateExecuteOptions {
  /** Context content */
  content: string
  /** Optional file paths for --files flag */
  files?: string[]
}

export interface ICurateUseCase {
  /**
   * Execute with an injected agent (v0.5.0 architecture).
   * UseCase receives agent from TaskProcessor, doesn't manage agent lifecycle.
   * Event streaming handled by agent-worker (subscribes to agentEventBus).
   *
   * @param agent - Long-lived CipherAgent
   * @param options - Execution options (content, file references)
   * @returns Result string from agent execution
   */
  executeWithAgent(agent: ICipherAgent, options: CurateExecuteOptions): Promise<string>

  /**
   * Run in REPL mode (with terminal output).
   */
  run(options: CurateUseCaseRunOptions): Promise<void>
}
