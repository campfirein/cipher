import type {BrvConfig} from '../../domain/entities/brv-config.js'
import type {ICipherAgent} from '../cipher/i-cipher-agent.js'
import type {ToolCallInfo, ToolResultInfo} from './i-curate-use-case.js'

/**
 * Options for REPL-style execution (with terminal output).
 */
export interface QueryUseCaseRunOptions {
  apiKey?: string
  model?: string
  query: string
  verbose?: boolean
}

/**
 * Options for Transport-style execution (headless, with callbacks).
 */
export interface QueryTransportOptions {
  /** Auth token (pre-loaded by CoreProcess) */
  authToken: {accessToken: string; sessionKey: string}
  /** Project config (pre-loaded by CoreProcess) */
  brvConfig?: BrvConfig
  /** Query content */
  query: string
}

/**
 * Callbacks for Transport-style execution (streaming results).
 */
export interface QueryTransportCallbacks {
  /** Called on each streaming chunk */
  onChunk?: (content: string) => void
  /** Called when task processing completes */
  onCompleted?: (result: string) => void
  /** Called when task encounters an error */
  onError?: (error: string) => void
  /** Called when task actually starts processing */
  onStarted?: () => void
  /** Called when a tool is invoked */
  onToolCall?: (info: ToolCallInfo) => void
  /** Called when a tool returns a result */
  onToolResult?: (info: ToolResultInfo) => void
}

/**
 * Options for executing with an injected agent (v7 architecture).
 */
export interface QueryExecuteOptions {
  /** Query content */
  query: string
}

export interface IQueryUseCase {
  /**
   * Execute with an injected agent (v0.5.0 architecture).
   * UseCase receives agent from TaskProcessor, doesn't manage agent lifecycle.
   * Event streaming handled by agent-worker (subscribes to agentEventBus).
   *
   * @param agent - Long-lived CipherAgent
   * @param options - Execution options (query)
   * @returns Result string from agent execution
   */
  executeWithAgent(agent: ICipherAgent, options: QueryExecuteOptions): Promise<string>

  /**
   * Run in REPL mode (with terminal output).
   */
  run(options: QueryUseCaseRunOptions): Promise<void>

  /**
   * Run in Transport mode (headless, with callbacks).
   * Called by TaskProcessor - streams results via callbacks.
   *
   * @deprecated Use executeWithAgent() instead for v7 architecture
   */
  runForTransport(options: QueryTransportOptions, callbacks?: QueryTransportCallbacks): Promise<void>
}
