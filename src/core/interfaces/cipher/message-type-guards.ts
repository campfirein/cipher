/**
 * Type guards for discriminated union types in the message system.
 *
 * These guards provide runtime type narrowing for:
 * - MessagePart union (text, image, file, reasoning, tool)
 * - ToolState union (pending, running, completed, error)
 * - InternalMessage roles (system, user, assistant, tool)
 *
 */

import type {
  FilePart,
  ImagePart,
  InternalMessage,
  MessagePart,
  ReasoningPart,
  TextPart,
  ToolPart,
  ToolState,
  ToolStateCompleted,
  ToolStateError,
  ToolStatePending,
  ToolStateRunning,
} from './message-types.js'

// ==================== MESSAGE PART TYPE GUARDS ====================

/**
 * Check if a message part is a TextPart.
 */
export function isTextPart(part: MessagePart): part is TextPart {
  return part.type === 'text'
}

/**
 * Check if a message part is an ImagePart.
 */
export function isImagePart(part: MessagePart): part is ImagePart {
  return part.type === 'image'
}

/**
 * Check if a message part is a FilePart.
 */
export function isFilePart(part: MessagePart): part is FilePart {
  return part.type === 'file'
}

/**
 * Check if a message part is a ReasoningPart.
 */
export function isReasoningPart(part: MessagePart): part is ReasoningPart {
  return part.type === 'reasoning'
}

/**
 * Check if a message part is a ToolPart.
 */
export function isToolPart(part: MessagePart): part is ToolPart {
  return part.type === 'tool'
}

// ==================== TOOL STATE TYPE GUARDS ====================

/**
 * Check if a tool state is pending.
 */
export function isToolPending(state: ToolState): state is ToolStatePending {
  return state.status === 'pending'
}

/**
 * Check if a tool state is running.
 */
export function isToolRunning(state: ToolState): state is ToolStateRunning {
  return state.status === 'running'
}

/**
 * Check if a tool state is completed.
 */
export function isToolCompleted(state: ToolState): state is ToolStateCompleted {
  return state.status === 'completed'
}

/**
 * Check if a tool state is error.
 */
export function isToolError(state: ToolState): state is ToolStateError {
  return state.status === 'error'
}

// ==================== MESSAGE ROLE TYPE GUARDS ====================

/**
 * Type for system messages.
 */
export type SystemMessage = InternalMessage & {role: 'system'}

/**
 * Type for user messages.
 */
export type UserMessage = InternalMessage & {role: 'user'}

/**
 * Type for assistant messages.
 */
export type AssistantMessage = InternalMessage & {role: 'assistant'}

/**
 * Type for tool messages.
 */
export type ToolMessage = InternalMessage & {role: 'tool'}

/**
 * Check if a message is a system message.
 */
export function isSystemMessage(msg: InternalMessage): msg is SystemMessage {
  return msg.role === 'system'
}

/**
 * Check if a message is a user message.
 */
export function isUserMessage(msg: InternalMessage): msg is UserMessage {
  return msg.role === 'user'
}

/**
 * Check if a message is an assistant message.
 */
export function isAssistantMessage(msg: InternalMessage): msg is AssistantMessage {
  return msg.role === 'assistant'
}

/**
 * Check if a message is a tool message.
 */
export function isToolMessage(msg: InternalMessage): msg is ToolMessage {
  return msg.role === 'tool'
}

// ==================== CONTENT TYPE GUARDS ====================

/**
 * Check if message content is a string.
 */
export function isStringContent(content: InternalMessage['content']): content is string {
  return typeof content === 'string'
}

/**
 * Check if message content is an array of parts.
 */
export function isPartsContent(content: InternalMessage['content']): content is MessagePart[] {
  return Array.isArray(content)
}

/**
 * Check if message content is null (e.g., assistant message with only tool calls).
 */
export function isNullContent(content: InternalMessage['content']): content is null {
  return content === null
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Extract text content from a message part array.
 * Returns concatenated text from all TextParts.
 */
export function extractTextFromParts(parts: MessagePart[]): string {
  return parts
    .filter((p): p is TextPart => isTextPart(p))
    .map((p) => p.text)
    .join('\n')
}

/**
 * Extract all images from a message part array.
 */
export function extractImagesFromParts(parts: MessagePart[]): ImagePart[] {
  return parts.filter((p): p is ImagePart => isImagePart(p))
}

/**
 * Extract all files from a message part array.
 */
export function extractFilesFromParts(parts: MessagePart[]): FilePart[] {
  return parts.filter((p): p is FilePart => isFilePart(p))
}

/**
 * Extract all tool parts from a message part array.
 */
export function extractToolPartsFromParts(parts: MessagePart[]): ToolPart[] {
  return parts.filter((p): p is ToolPart => isToolPart(p))
}

/**
 * Check if a message has any attachments (images or files).
 */
export function hasAttachments(parts: MessagePart[]): boolean {
  return parts.some((p) => isImagePart(p) || isFilePart(p))
}

/**
 * Check if a message has any tool calls.
 */
export function hasToolCalls(msg: InternalMessage): boolean {
  return Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0
}

/**
 * Get completed tool parts from a message part array.
 */
export function getCompletedToolParts(parts: MessagePart[]): ToolPart[] {
  return parts.filter((p): p is ToolPart => isToolPart(p) && isToolCompleted(p.state))
}

/**
 * Get error tool parts from a message part array.
 */
export function getErrorToolParts(parts: MessagePart[]): ToolPart[] {
  return parts.filter((p): p is ToolPart => isToolPart(p) && isToolError(p.state))
}

/**
 * Get running tool parts from a message part array.
 */
export function getRunningToolParts(parts: MessagePart[]): ToolPart[] {
  return parts.filter((p): p is ToolPart => isToolPart(p) && isToolRunning(p.state))
}

/**
 * Get pending tool parts from a message part array.
 */
export function getPendingToolParts(parts: MessagePart[]): ToolPart[] {
  return parts.filter((p): p is ToolPart => isToolPart(p) && isToolPending(p.state))
}
