import {randomUUID} from 'node:crypto'

import type {
  CompactionResult,
  LoadMessagesResult,
  PruneToolOutputsOptions,
  SessionRecord,
  StoredMessage,
  StoredMessageWithParts,
  StoredPart,
  StoredToolState,
  StreamMessagesOptions,
} from '../../core/domain/storage/message-storage-types.js'
import type {IKeyStorage, StorageKey} from '../../core/interfaces/i-key-storage.js'
import type {AttachmentPart, InternalMessage, MessagePart, ToolPart} from '../../core/interfaces/message-types.js'

import {COMPACTED_TOOL_OUTPUT_PLACEHOLDER} from '../../core/domain/storage/message-storage-types.js'
import {ToolPartFactory} from './tool-part-factory.js'

/**
 * Options for creating a tool part.
 */
export interface CreateToolPartOptions {
  /** Unique identifier for this tool call */
  callId: string
  /** Parsed input arguments */
  input: Record<string, unknown>
  /** ID of the message to add the tool part to */
  messageId: string
  /** Session ID for validation */
  sessionId: string
  /** Name of the tool being called */
  toolName: string
}

/**
 * Service for granular message and part storage.
 *
 * Handles the conversion between InternalMessage format and the granular
 * StoredMessage/StoredPart format, enabling:
 * - Streaming message loading (newest to oldest)
 * - Selective tool output pruning
 * - Compaction boundary markers
 *
 * Key structure:
 * - ["session", sessionId] → SessionRecord
 * - ["message", sessionId, messageId] → StoredMessage
 * - ["part", messageId, partId] → StoredPart
 */
export class MessageStorageService {
  constructor(private readonly keyStorage: IKeyStorage) {}

  /**
   * Add attachments to a completed tool part.
   *
   * @param messageId - ID of the message containing the part
   * @param partId - ID of the tool part
   * @param attachments - Attachments to add
   */
  async addToolPartAttachments(
    messageId: string,
    partId: string,
    attachments: AttachmentPart[],
  ): Promise<void> {
    await this.keyStorage.update<StoredPart>(this.partKey(messageId, partId), (prev) => {
      if (!prev) throw new Error(`Part ${partId} not found`)
      if (prev.type !== 'tool' || !prev.toolState) {
        throw new Error(`Part ${partId} is not a tool part`)
      }

      const existingAttachments = prev.toolState.attachments ?? []
      const newAttachments = attachments.map((att) => ({
        data: att.data,
        filename: att.filename,
        mime: att.mime,
        type: att.type,
      }))

      return {
        ...prev,
        toolState: {
          ...prev.toolState,
          attachments: [...existingAttachments, ...newAttachments],
        },
      }
    })
  }

  /**
   * Create a tool part in pending state and add it to a message.
   *
   * @param options - Options for creating the tool part
   * @returns The created StoredPart
   */
  async createToolPart(options: CreateToolPartOptions): Promise<StoredPart> {
    const {callId, input, messageId, sessionId, toolName} = options

    // Verify message exists
    const message = await this.keyStorage.get<StoredMessage>(this.messageKey(sessionId, messageId))
    if (!message) {
      throw new Error(`Message ${messageId} not found in session ${sessionId}`)
    }

    // Create the tool part in pending state
    const toolPart = ToolPartFactory.createPending(messageId, callId, toolName, input)

    // Save the part
    await this.keyStorage.set(this.partKey(messageId, toolPart.id), toolPart)

    // Update message's partIds
    const now = Date.now()
    await this.keyStorage.update<StoredMessage>(this.messageKey(sessionId, messageId), (prev) => {
      if (!prev) throw new Error(`Message ${messageId} not found`)
      return {
        ...prev,
        partIds: [...prev.partIds, toolPart.id],
        updatedAt: now,
      }
    })

    return toolPart
  }

  /**
   * Delete a session and all its messages and parts.
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId)
    if (!session) {
      return false
    }

    // Delete all messages and their parts
    const messageKeys = await this.keyStorage.list(this.messagePrefix(sessionId))
    for (const messageKey of messageKeys) {
      const messageId = messageKey[2]
      // Delete all parts for this message
      // eslint-disable-next-line no-await-in-loop
      const partKeys = await this.keyStorage.list(this.partPrefix(messageId))
      for (const partKey of partKeys) {
        // eslint-disable-next-line no-await-in-loop
        await this.keyStorage.delete(partKey)
      }

      // Delete the message
      // eslint-disable-next-line no-await-in-loop
      await this.keyStorage.delete(messageKey)
    }

    // Delete the session record
    return this.keyStorage.delete(this.sessionKey(sessionId))
  }

  /**
   * Get the session record, if it exists.
   */
  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    return this.keyStorage.get<SessionRecord>(this.sessionKey(sessionId))
  }

  /**
   * Get a tool part by call ID from a message.
   *
   * @param messageId - ID of the message
   * @param callId - Call ID of the tool part
   * @returns The tool part if found
   */
  async getToolPartByCallId(messageId: string, callId: string): Promise<StoredPart | undefined> {
    const partKeys = await this.keyStorage.list(this.partPrefix(messageId))

    for (const partKey of partKeys) {
      // eslint-disable-next-line no-await-in-loop
      const part = await this.keyStorage.get<StoredPart>(partKey)
      if (part?.type === 'tool' && part.toolState?.callId === callId) {
        return part
      }
    }

    return undefined
  }

  /**
   * Check if a session exists in granular format.
   */
  async hasSession(sessionId: string): Promise<boolean> {
    return this.keyStorage.exists(this.sessionKey(sessionId))
  }

  /**
   * Insert a compaction boundary marker.
   * Creates a special message that signals where to stop loading history.
   */
  async insertCompactionBoundary(sessionId: string, summary: string): Promise<StoredMessage> {
    const now = Date.now()
    const messageId = randomUUID()

    // Get session
    const session = await this.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Create compaction boundary message
    const boundaryMessage: StoredMessage = {
      compactionBoundary: true,
      compactionSummary: summary,
      content: summary,
      createdAt: now,
      id: messageId,
      partIds: [],
      prevMessageId: session.newestMessageId,
      role: 'user', // Compaction boundaries are modeled as user messages
      sessionId,
      updatedAt: now,
    }

    // Update the previous newest message
    if (session.newestMessageId) {
      await this.keyStorage.update<StoredMessage>(this.messageKey(sessionId, session.newestMessageId), (prev) => {
        if (!prev) throw new Error(`Previous message ${session.newestMessageId} not found`)
        return {...prev, nextMessageId: messageId, updatedAt: now}
      })
    }

    // Save boundary message
    await this.keyStorage.set(this.messageKey(sessionId, messageId), boundaryMessage)

    // Update session
    session.newestMessageId = messageId
    session.lastCompactionMessageId = messageId
    session.messageCount += 1
    session.updatedAt = now

    await this.saveSession(session)

    return boundaryMessage
  }

  /**
   * List all session IDs in granular format.
   */
  async listSessions(): Promise<string[]> {
    const sessionKeys = await this.keyStorage.list(['session'])
    return sessionKeys.map((key) => key[1]) // ["session", sessionId] -> sessionId
  }

  /**
   * Load messages from a session, stopping at compaction boundary.
   * Returns messages in chronological order (oldest first).
   */
  async loadMessages(sessionId: string, options?: {stopAtCompaction?: boolean}): Promise<LoadMessagesResult> {
    const session = await this.getSession(sessionId)
    if (!session || !session.newestMessageId) {
      return {hitCompactionBoundary: false, messages: []}
    }

    const stopAtCompaction = options?.stopAtCompaction ?? true
    const messages: StoredMessageWithParts[] = []
    let hitCompactionBoundary = false

    // Traverse from newest to oldest
    let currentMessageId: string | undefined = session.newestMessageId
    while (currentMessageId) {
      // eslint-disable-next-line no-await-in-loop
      const storedMsg: StoredMessage | undefined = await this.keyStorage.get<StoredMessage>(
        this.messageKey(sessionId, currentMessageId),
      )
      if (!storedMsg) break

      // Load parts for this message
      // eslint-disable-next-line no-await-in-loop
      const parts = await this.loadParts(storedMsg)
      const messageWithParts: StoredMessageWithParts = {...storedMsg, parts}

      // Check for compaction boundary
      if (stopAtCompaction && storedMsg.compactionBoundary) {
        // Include the compaction boundary message itself
        messages.unshift(messageWithParts)
        hitCompactionBoundary = true
        break
      }

      messages.unshift(messageWithParts)
      currentMessageId = storedMsg.prevMessageId
    }

    return {hitCompactionBoundary, messages}
  }

  /**
   * Prune old tool outputs by marking them as compacted.
   * Keeps the most recent tool outputs up to the specified token limit.
   *
   * Turn-based protection: Protects tool outputs in the most recent N user turns.
   * Minimum threshold: Only executes if the minimum token threshold can be saved.
   */
  async pruneToolOutputs(options: PruneToolOutputsOptions): Promise<CompactionResult> {
    const {keepTokens = 40_000, minimumTokens = 20_000, protectedTurns = 2, sessionId} = options
    const session = await this.getSession(sessionId)

    if (!session || !session.newestMessageId) {
      return {compactedCount: 0, tokensSaved: 0}
    }

    // Collect all tool output parts, newest first
    // Track user turns for turn-based protection
    const toolOutputParts: Array<{key: StorageKey; part: StoredPart; protected: boolean}> = []
    let userTurnCount = 0

    // Traverse messages from newest to oldest
    let currentMessageId: string | undefined = session.newestMessageId
    while (currentMessageId) {
      // eslint-disable-next-line no-await-in-loop
      const storedMsg: StoredMessage | undefined = await this.keyStorage.get<StoredMessage>(
        this.messageKey(sessionId, currentMessageId),
      )
      if (!storedMsg) break

      // Stop at existing compaction boundary
      if (storedMsg.compactionBoundary) break

      // Track user turns for turn-based protection
      if (storedMsg.role === 'user') {
        userTurnCount++
      }

      // Determine if this message's tool outputs are protected
      const isProtected = userTurnCount <= protectedTurns

      // Collect tool output parts from this message
      for (const partId of storedMsg.partIds) {
        // eslint-disable-next-line no-await-in-loop
        const part = await this.keyStorage.get<StoredPart>(this.partKey(storedMsg.id, partId))
        if (part && part.type === 'tool_output' && !part.compactedAt) {
          toolOutputParts.push({
            key: this.partKey(storedMsg.id, partId),
            part,
            protected: isProtected,
          })
        }
      }

      currentMessageId = storedMsg.prevMessageId
    }

    // First pass: Calculate potential tokens saved (only from unprotected parts)
    let keptTokens = 0
    let potentialTokensSaved = 0
    const partsToCompact: Array<{key: StorageKey; part: StoredPart; tokens: number}> = []

    for (const {key, part, protected: isProtected} of toolOutputParts) {
      const estimatedTokens = Math.ceil(part.content.length / 4)

      if (isProtected || keptTokens < keepTokens) {
        // Keep this part (either protected or within token limit)
        keptTokens += estimatedTokens
      } else {
        // This part is a candidate for compaction
        partsToCompact.push({key, part, tokens: estimatedTokens})
        potentialTokensSaved += estimatedTokens
      }
    }

    // Check minimum threshold: only proceed if we can save enough tokens
    if (potentialTokensSaved < minimumTokens) {
      return {compactedCount: 0, tokensSaved: 0}
    }

    // Second pass: Actually compact the parts
    let compactedCount = 0
    let tokensSaved = 0
    const now = Date.now()

    for (const {key, part, tokens} of partsToCompact) {
      // eslint-disable-next-line no-await-in-loop
      await this.keyStorage.set(key, {
        ...part,
        compactedAt: now,
        content: '', // Clear the content to save space
      })
      compactedCount++
      tokensSaved += tokens
    }

    return {compactedCount, tokensSaved}
  }

  /**
   * Save a single message with its parts.
   * Updates the session record to maintain linked list pointers.
   */
  async saveMessage(sessionId: string, message: InternalMessage): Promise<StoredMessage> {
    const now = Date.now()
    const messageId = randomUUID()

    // Convert InternalMessage content to parts
    const {content, parts} = this.extractParts(message, messageId, now)

    // Get or create session
    let session = await this.getSession(sessionId)
    const isNewSession = !session

    if (isNewSession) {
      session = {
        createdAt: now,
        messageCount: 0,
        sessionId,
        updatedAt: now,
      }
    }

    // Create stored message
    const storedMessage: StoredMessage = {
      content,
      createdAt: now,
      id: messageId,
      name: message.name,
      partIds: parts.map((p) => p.id),
      prevMessageId: session!.newestMessageId,
      reasoning: message.reasoning,
      role: message.role,
      sessionId,
      thought: message.thought,
      thoughtSummary: message.thoughtSummary,
      toolCallId: message.toolCallId,
      toolCalls: message.toolCalls,
      updatedAt: now,
    }

    // Update the previous newest message to point to this one
    if (session!.newestMessageId) {
      await this.keyStorage.update<StoredMessage>(this.messageKey(sessionId, session!.newestMessageId), (prev) => {
        if (!prev) throw new Error(`Previous message ${session!.newestMessageId} not found`)
        return {...prev, nextMessageId: messageId, updatedAt: now}
      })
    }

    // Save parts
    for (const part of parts) {
      // eslint-disable-next-line no-await-in-loop
      await this.keyStorage.set(this.partKey(part.messageId, part.id), part)
    }

    // Save message
    await this.keyStorage.set(this.messageKey(sessionId, messageId), storedMessage)

    // Update session
    session!.newestMessageId = messageId
    if (!session!.oldestMessageId) {
      session!.oldestMessageId = messageId
    }

    session!.messageCount += 1
    session!.updatedAt = now

    await this.saveSession(session!)

    return storedMessage
  }

  /**
   * Save multiple messages in order.
   * More efficient than calling saveMessage multiple times.
   */
  async saveMessages(sessionId: string, messages: InternalMessage[]): Promise<StoredMessage[]> {
    const results: StoredMessage[] = []

    for (const message of messages) {
      // eslint-disable-next-line no-await-in-loop
      const stored = await this.saveMessage(sessionId, message)
      results.push(stored)
    }

    return results
  }

  /**
   * Create or update a session record.
   */
  async saveSession(session: SessionRecord): Promise<void> {
    await this.keyStorage.set(this.sessionKey(session.sessionId), session)
  }

  /**
   * Stream messages from newest to oldest using an async generator.
   * More memory efficient for large histories.
   *
   * @yields StoredMessageWithParts - Messages from the session history
   */
  async *streamMessages(options: StreamMessagesOptions): AsyncGenerator<StoredMessageWithParts> {
    const {limit, sessionId, stopAtCompaction = true} = options
    const session = await this.getSession(sessionId)
    if (!session || !session.newestMessageId) {
      return
    }

    let count = 0
    let currentMessageId: string | undefined = session.newestMessageId

    while (currentMessageId) {
      if (limit && count >= limit) break

      // eslint-disable-next-line no-await-in-loop
      const storedMsg: StoredMessage | undefined = await this.keyStorage.get<StoredMessage>(
        this.messageKey(sessionId, currentMessageId),
      )
      if (!storedMsg) break

      // Load parts for this message
      // eslint-disable-next-line no-await-in-loop
      const parts = await this.loadParts(storedMsg)
      const messageWithParts: StoredMessageWithParts = {...storedMsg, parts}

      yield messageWithParts
      count++

      // Stop at compaction boundary (but yield it first)
      if (stopAtCompaction && storedMsg.compactionBoundary) {
        break
      }

      currentMessageId = storedMsg.prevMessageId
    }
  }

  /**
   * Convert a single stored message with parts back to InternalMessage format.
   */
  toInternalMessage(message: StoredMessageWithParts): InternalMessage {
    // Reconstruct content from parts or use stored content
    const {content: messageContent, parts} = message
    let content: Array<MessagePart> | null | string = messageContent

    // If we have parts, reconstruct the content array
    if (parts.length > 0) {
      const contentParts: MessagePart[] = []

      for (const part of parts) {
        const converted = this.convertStoredPartToMessagePart(part)
        if (converted.messagePart) {
          contentParts.push(converted.messagePart)
        }

        if (converted.toolOutputContent !== undefined) {
          content = converted.toolOutputContent
        }
      }

      // Only use content parts array if we have non-tool parts or tool parts
      if (contentParts.length > 0 && (message.role === 'user' || message.role === 'assistant')) {
        content = contentParts
      }
    }

    const {name, reasoning, role, thought, thoughtSummary, toolCallId, toolCalls} = message

    return {
      content,
      name,
      reasoning,
      role,
      thought,
      thoughtSummary,
      toolCallId,
      toolCalls,
    }
  }

  /**
   * Convert loaded messages back to InternalMessage format.
   */
  toInternalMessages(messages: StoredMessageWithParts[]): InternalMessage[] {
    return messages.map((msg) => this.toInternalMessage(msg))
  }

  /**
   * Update a tool part's state.
   * Used for transitioning through pending → running → completed/error.
   *
   * @param messageId - ID of the message containing the part
   * @param partId - ID of the tool part to update
   * @param update - Partial tool state update
   */
  async updateToolPartState(
    messageId: string,
    partId: string,
    update: Partial<StoredToolState>,
  ): Promise<void> {
    await this.keyStorage.update<StoredPart>(this.partKey(messageId, partId), (prev) => {
      if (!prev) throw new Error(`Part ${partId} not found`)
      if (prev.type !== 'tool' || !prev.toolState) {
        throw new Error(`Part ${partId} is not a tool part`)
      }

      return {
        ...prev,
        toolState: {
          ...prev.toolState,
          ...update,
        },
      }
    })
  }

  /**
   * Convert a StoredPart to a MessagePart for reconstruction.
   * Returns the converted part and optionally tool output content.
   */
  private convertStoredPartToMessagePart(
    part: StoredPart,
  ): {messagePart?: MessagePart; toolOutputContent?: string} {
    // Handle compacted parts
    if (part.compactedAt) {
      return {
        messagePart: {
          text: part.type === 'tool_output' ? COMPACTED_TOOL_OUTPUT_PLACEHOLDER : '[Content cleared]',
          type: 'text',
        },
      }
    }

    // Convert based on part type
    switch (part.type) {
      case 'file': {
        return {
          messagePart: {
            data: part.content,
            filename: part.filename,
            mimeType: part.mimeType || 'application/octet-stream',
            type: 'file',
          },
        }
      }

      case 'image': {
        return {
          messagePart: {
            image: part.content,
            mimeType: part.mimeType,
            type: 'image',
          },
        }
      }

      case 'reasoning': {
        return {
          messagePart: {
            summary: part.reasoningSummary,
            text: part.content,
            type: 'reasoning',
          },
        }
      }

      case 'text': {
        return {
          messagePart: {text: part.content, type: 'text'},
        }
      }

      case 'tool': {
        if (!part.toolState) return {}
        return {
          messagePart: this.storedPartToToolPart(part),
        }
      }

      case 'tool_output': {
        // Tool output becomes text content for tool messages
        return {toolOutputContent: part.content}
      }

      default: {
        return {}
      }
    }
  }

  /**
   * Extract parts from an InternalMessage.
   */
  private extractParts(
    message: InternalMessage,
    messageId: string,
    now: number,
  ): {content: null | string; parts: StoredPart[]} {
    const parts: StoredPart[] = []
    let content: null | string = null

    if (message.content === null) {
      // Assistant message with only tool calls
      content = null
    } else if (typeof message.content === 'string') {
      // Tool result or simple text message
      if (message.role === 'tool') {
        // Store tool output as a part for selective pruning
        const partId = randomUUID()
        parts.push({
          content: message.content,
          createdAt: now,
          id: partId,
          messageId,
          toolName: message.name,
          type: 'tool_output',
        })
        content = message.content // Also keep in content for quick access
      } else {
        // System or simple assistant message
        content = message.content
      }
    } else if (Array.isArray(message.content)) {
      // User message with multiple parts
      for (const part of message.content) {
        const partId = randomUUID()

        switch (part.type) {
          case 'file': {
            parts.push({
              content: this.serializeFileContent(part.data),
              createdAt: now,
              filename: part.filename,
              id: partId,
              messageId,
              mimeType: part.mimeType,
              type: 'file',
            })

            break
          }

          case 'image': {
            parts.push({
              content: this.serializeImageContent(part.image),
              createdAt: now,
              id: partId,
              messageId,
              mimeType: part.mimeType,
              type: 'image',
            })

            break
          }

          case 'reasoning': {
            parts.push({
              content: part.text,
              createdAt: now,
              id: partId,
              messageId,
              reasoningSummary: part.summary,
              type: 'reasoning',
            })

            break
          }

          case 'text': {
            parts.push({
              content: part.text,
              createdAt: now,
              id: partId,
              messageId,
              type: 'text',
            })

            break
          }

          case 'tool': {
            // Store tool part with full state
            parts.push(this.toolPartToStoredPart(part, partId, messageId, now))

            break
          }
        }
      }

      // For user/assistant messages, content is reconstructed from parts
      // but we can store a text preview
      const textParts = message.content.filter((p) => p.type === 'text') as Array<{text: string; type: 'text'}>
      if (textParts.length > 0) {
        content = textParts.map((p) => p.text).join('\n')
      }
    }

    return {content, parts}
  }

  /**
   * Load parts for a message.
   */
  private async loadParts(message: StoredMessage): Promise<StoredPart[]> {
    const parts: StoredPart[] = []

    for (const partId of message.partIds) {
      // eslint-disable-next-line no-await-in-loop
      const part = await this.keyStorage.get<StoredPart>(this.partKey(message.id, partId))
      if (part) {
        parts.push(part)
      }
    }

    return parts
  }

  // Key builders
  private messageKey(sessionId: string, messageId: string): StorageKey {
    return ['message', sessionId, messageId]
  }

  private messagePrefix(sessionId: string): StorageKey {
    return ['message', sessionId]
  }

  private partKey(messageId: string, partId: string): StorageKey {
    return ['part', messageId, partId]
  }

  private partPrefix(messageId: string): StorageKey {
    return ['part', messageId]
  }

  /**
   * Serialize file content for storage.
   */
  private serializeFileContent(data: ArrayBuffer | Buffer | string | Uint8Array | URL): string {
    return this.serializeImageContent(data)
  }

  /**
   * Serialize image content for storage.
   */
  private serializeImageContent(image: ArrayBuffer | Buffer | string | Uint8Array | URL): string {
    if (typeof image === 'string') {
      return image
    }

    if (image instanceof URL) {
      return image.toString()
    }

    if (image instanceof ArrayBuffer) {
      return Buffer.from(image).toString('base64')
    }

    if (image instanceof Uint8Array) {
      return Buffer.from(image).toString('base64')
    }

    // Buffer.isBuffer check is redundant since Buffer extends Uint8Array,
    // but we keep it explicit for clarity
    return (image as Buffer).toString('base64')
  }

  private sessionKey(sessionId: string): StorageKey {
    return ['session', sessionId]
  }

  /**
   * Convert a stored part with tool state to a ToolPart.
   */
  private storedPartToToolPart(part: StoredPart): ToolPart {
    if (!part.toolState || !part.toolName) {
      throw new Error('Cannot convert non-tool part to ToolPart')
    }

    return {
      callId: part.toolState.callId,
      state: ToolPartFactory.toToolPartState(part.toolState),
      toolName: part.toolName,
      type: 'tool',
    }
  }

  /**
   * Convert a ToolPart to a StoredPart.
   */
  private toolPartToStoredPart(part: ToolPart, partId: string, messageId: string, now: number): StoredPart {
    const {callId, state, toolName} = part

    // Build stored tool state from ToolPart state
    const toolState: StoredToolState = {
      callId,
      input: state.input,
      status: state.status,
    }

    // Add state-specific fields
    switch (state.status) {
      case 'completed': {
        toolState.attachments = state.attachments?.map((att) => ({
          data: att.data,
          filename: att.filename,
          mime: att.mime,
          type: att.type,
        }))
        toolState.completedAt = state.time.end
        toolState.output = state.output
        toolState.startedAt = state.time.start
        toolState.title = state.title
        break
      }

      case 'error': {
        toolState.completedAt = state.time.end
        toolState.error = state.error
        toolState.startedAt = state.time.start
        break
      }

      case 'pending': {
        // No additional fields for pending state
        break
      }

      case 'running': {
        toolState.startedAt = state.startedAt
        break
      }
    }

    return {
      content: '',
      createdAt: now,
      id: partId,
      messageId,
      toolName,
      toolState,
      type: 'tool',
    }
  }
}

/**
 * Factory function to create MessageStorageService.
 */
export function createMessageStorageService(keyStorage: IKeyStorage): MessageStorageService {
  return new MessageStorageService(keyStorage)
}
