import type {BrvConfig} from '../../domain/entities/brv-config.js'

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
 * Options for Transport-style execution (headless, with callbacks).
 */
export interface CurateTransportOptions {
  /** Auth token (pre-loaded by CoreProcess) */
  authToken: {accessToken: string; sessionKey: string}
  /** Project config (pre-loaded by CoreProcess) */
  brvConfig?: BrvConfig
  /** Context content */
  content: string
  /** Optional file reference instructions */
  fileReferenceInstructions?: string
}

/**
 * Tool call info for streaming.
 */
export interface ToolCallInfo {
  /** Tool arguments */
  args?: Record<string, unknown>
  /** Tool call ID */
  callId: string
  /** Tool name */
  name: string
}

/**
 * Tool result info for streaming.
 */
export interface ToolResultInfo {
  /** Tool call ID */
  callId: string
  /** Error message if failed */
  error?: string
  /** Result data */
  result?: unknown
  /** Whether the tool call succeeded */
  success: boolean
}

/**
 * Callbacks for Transport-style execution (streaming results).
 */
export interface CurateTransportCallbacks {
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

export interface ICurateUseCase {
  /**
   * Run in REPL mode (with terminal output).
   */
  run(options: CurateUseCaseRunOptions): Promise<void>

  /**
   * Run in Transport mode (headless, with callbacks).
   * Called by TaskProcessor - streams results via callbacks.
   */
  runForTransport(options: CurateTransportOptions, callbacks?: CurateTransportCallbacks): Promise<void>
}
