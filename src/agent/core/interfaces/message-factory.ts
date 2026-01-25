/**
 * Factory functions for creating validated message parts and messages.
 *
 * These factories provide a consistent way to create message parts with:
 * - Proper type assignment
 * - Optional metadata and synthetic flags
 * - Default values where appropriate
 *
 */

import type {
  FilePart,
  ImagePart,
  InternalMessage,
  ReasoningPart,
  TextPart,
  ToolCall,
  ToolPart,
  ToolStateCompleted,
  ToolStateError,
  ToolStatePending,
  ToolStateRunning,
} from './message-types.js'

// ==================== PART CREATION OPTIONS ====================

/**
 * Common options for creating message parts.
 */
export interface PartOptions {
  /** Part-level metadata for cache hints and custom data */
  metadata?: {
    [key: string]: unknown
    cacheControl?: {type: 'ephemeral' | 'permanent'}
  }
  /** Whether this is auto-generated content */
  synthetic?: boolean
}

// ==================== TEXT PART FACTORY ====================

/**
 * Create a TextPart with the given text content.
 */
export function createTextPart(text: string, options?: PartOptions): TextPart {
  return {
    text,
    type: 'text',
    ...(options?.synthetic !== undefined && {synthetic: options.synthetic}),
    ...(options?.metadata && {metadata: options.metadata}),
  }
}

// ==================== IMAGE PART FACTORY ====================

/**
 * Create an ImagePart with the given image data.
 */
export function createImagePart(
  image: ImagePart['image'],
  mimeType?: string,
  options?: PartOptions,
): ImagePart {
  return {
    image,
    type: 'image',
    ...(mimeType && {mimeType}),
    ...(options?.synthetic !== undefined && {synthetic: options.synthetic}),
    ...(options?.metadata && {metadata: options.metadata}),
  }
}

// ==================== FILE PART FACTORY ====================

/**
 * Create a FilePart with the given file data.
 */
export function createFilePart(
  data: FilePart['data'],
  mimeType: string,
  filename?: string,
  options?: PartOptions,
): FilePart {
  return {
    data,
    mimeType,
    type: 'file',
    ...(filename && {filename}),
    ...(options?.synthetic !== undefined && {synthetic: options.synthetic}),
    ...(options?.metadata && {metadata: options.metadata}),
  }
}

// ==================== REASONING PART FACTORY ====================

/**
 * Create a ReasoningPart with the given thinking text.
 */
export function createReasoningPart(
  text: string,
  summary?: {description: string; subject: string},
  options?: PartOptions,
): ReasoningPart {
  return {
    text,
    type: 'reasoning',
    ...(summary && {summary}),
    ...(options?.synthetic !== undefined && {synthetic: options.synthetic}),
    ...(options?.metadata && {metadata: options.metadata}),
  }
}

// ==================== TOOL PART FACTORY ====================

/**
 * Create a ToolPart in pending state.
 */
export function createToolPart(
  callId: string,
  toolName: string,
  input: Record<string, unknown>,
  options?: PartOptions,
): ToolPart {
  const state: ToolStatePending = {
    input,
    status: 'pending',
  }

  return {
    callId,
    state,
    toolName,
    type: 'tool',
    ...(options?.synthetic !== undefined && {synthetic: options.synthetic}),
    ...(options?.metadata && {metadata: options.metadata}),
  }
}

/**
 * Create a ToolPart in running state.
 */
export function createRunningToolPart(
  callId: string,
  toolName: string,
  input: Record<string, unknown>,
  options?: PartOptions & {startedAt?: number},
): ToolPart {
  const state: ToolStateRunning = {
    input,
    startedAt: options?.startedAt ?? Date.now(),
    status: 'running',
  }

  return {
    callId,
    state,
    toolName,
    type: 'tool',
    ...(options?.synthetic !== undefined && {synthetic: options.synthetic}),
    ...(options?.metadata && {metadata: options.metadata}),
  }
}

/**
 * Options for creating a completed tool part.
 */
export interface CreateCompletedToolPartOptions extends PartOptions {
  additionalOptions?: {
    attachments?: ToolStateCompleted['attachments']
    compactedAt?: number
    metadata?: Record<string, unknown>
    title?: string
  }
  callId: string
  input: Record<string, unknown>
  output: string
  time?: {end: number; start: number}
  toolName: string
}

/**
 * Create a ToolPart in completed state.
 */
export function createCompletedToolPart(options: CreateCompletedToolPartOptions): ToolPart {
  const time = options.time ?? {end: Date.now(), start: Date.now()}
  const state: ToolStateCompleted = {
    input: options.input,
    output: options.output,
    status: 'completed',
    time,
    ...(options.additionalOptions?.attachments && {attachments: options.additionalOptions.attachments}),
    ...(options.additionalOptions?.compactedAt && {compactedAt: options.additionalOptions.compactedAt}),
    ...(options.additionalOptions?.metadata && {metadata: options.additionalOptions.metadata}),
    ...(options.additionalOptions?.title && {title: options.additionalOptions.title}),
  }

  return {
    callId: options.callId,
    state,
    toolName: options.toolName,
    type: 'tool',
    ...(options.synthetic !== undefined && {synthetic: options.synthetic}),
    ...(options.metadata && {metadata: options.metadata}),
  }
}

/**
 * Options for creating an error tool part.
 */
export interface CreateErrorToolPartOptions extends PartOptions {
  callId: string
  error: string
  input: Record<string, unknown>
  time?: {end: number; start: number}
  toolName: string
}

/**
 * Create a ToolPart in error state.
 */
export function createErrorToolPart(options: CreateErrorToolPartOptions): ToolPart {
  const time = options.time ?? {end: Date.now(), start: Date.now()}
  const state: ToolStateError = {
    error: options.error,
    input: options.input,
    status: 'error',
    time,
  }

  return {
    callId: options.callId,
    state,
    toolName: options.toolName,
    type: 'tool',
    ...(options.synthetic !== undefined && {synthetic: options.synthetic}),
    ...(options.metadata && {metadata: options.metadata}),
  }
}

// ==================== TOOL STATE TRANSITIONS ====================

/**
 * Transition a tool state from pending to running.
 */
export function transitionToRunning(state: ToolStatePending, startedAt: number = Date.now()): ToolStateRunning {
  return {
    input: state.input,
    startedAt,
    status: 'running',
  }
}

/**
 * Transition a tool state from running to completed.
 */
export function transitionToCompleted(
  state: ToolStateRunning,
  output: string,
  endedAt: number = Date.now(),
  additionalOptions?: {
    attachments?: ToolStateCompleted['attachments']
    metadata?: Record<string, unknown>
    title?: string
  },
): ToolStateCompleted {
  return {
    input: state.input,
    output,
    status: 'completed',
    time: {end: endedAt, start: state.startedAt},
    ...(additionalOptions?.attachments && {attachments: additionalOptions.attachments}),
    ...(additionalOptions?.metadata && {metadata: additionalOptions.metadata}),
    ...(additionalOptions?.title && {title: additionalOptions.title}),
  }
}

/**
 * Transition a tool state from running to error.
 */
export function transitionToError(
  state: ToolStateRunning,
  error: string,
  endedAt: number = Date.now(),
): ToolStateError {
  return {
    error,
    input: state.input,
    status: 'error',
    time: {end: endedAt, start: state.startedAt},
  }
}

// ==================== TOOL CALL FACTORY ====================

/**
 * Create a ToolCall from function name and arguments.
 */
export function createToolCall(
  id: string,
  name: string,
  args: Record<string, unknown> | string,
): ToolCall {
  return {
    function: {
      arguments: typeof args === 'string' ? args : JSON.stringify(args),
      name,
    },
    id,
    type: 'function',
  }
}

// ==================== MESSAGE FACTORY ====================

/**
 * Options for creating internal messages.
 */
export interface MessageOptions {
  /** Message-level metadata */
  metadata?: {
    [key: string]: unknown
    compactedAt?: number
    isSummary?: boolean
    summarizedMessageCount?: number
  }
}

/**
 * Create a system message.
 */
export function createSystemMessage(content: string, options?: MessageOptions): InternalMessage {
  return {
    content,
    role: 'system',
    ...(options?.metadata && {metadata: options.metadata}),
  }
}

/**
 * Create a user message with text content.
 */
export function createUserMessage(
  content: InternalMessage['content'] | string,
  options?: MessageOptions,
): InternalMessage {
  return {
    content: typeof content === 'string' ? content : content,
    role: 'user',
    ...(options?.metadata && {metadata: options.metadata}),
  }
}

/**
 * Create an assistant message with text content.
 */
export function createAssistantMessage(
  content: InternalMessage['content'] | string,
  additionalOptions?: {
    reasoning?: string
    thought?: string
    thoughtSummary?: {description: string; subject: string}
    toolCalls?: ToolCall[]
  },
  options?: MessageOptions,
): InternalMessage {
  return {
    content,
    role: 'assistant',
    ...(additionalOptions?.reasoning && {reasoning: additionalOptions.reasoning}),
    ...(additionalOptions?.thought && {thought: additionalOptions.thought}),
    ...(additionalOptions?.thoughtSummary && {thoughtSummary: additionalOptions.thoughtSummary}),
    ...(additionalOptions?.toolCalls && {toolCalls: additionalOptions.toolCalls}),
    ...(options?.metadata && {metadata: options.metadata}),
  }
}

/**
 * Create a tool result message.
 */
export function createToolResultMessage(
  content: InternalMessage['content'] | string,
  toolCallId: string,
  name: string,
  options?: MessageOptions,
): InternalMessage {
  return {
    content,
    name,
    role: 'tool',
    toolCallId,
    ...(options?.metadata && {metadata: options.metadata}),
  }
}

/**
 * Create a summary message (used by compression strategies).
 */
export function createSummaryMessage(
  summaryContent: string,
  summarizedMessageCount: number,
  options?: Omit<MessageOptions, 'metadata'> & {additionalMetadata?: Record<string, unknown>},
): InternalMessage {
  return {
    content: `[Conversation Summary]\n${summaryContent}`,
    metadata: {
      compactedAt: Date.now(),
      isSummary: true,
      summarizedMessageCount,
      ...options?.additionalMetadata,
    },
    role: 'system',
  }
}
