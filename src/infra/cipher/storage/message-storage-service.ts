import {randomUUID} from 'node:crypto'

import type {
  CompactionResult,
  LoadMessagesResult,
  PruneToolOutputsOptions,
  SessionRecord,
  StoredMessage,
  StoredMessageWithParts,
  StoredPart,
  StreamMessagesOptions,
} from '../../../core/domain/cipher/storage/message-storage-types.js'
import type {IKeyStorage, StorageKey} from '../../../core/interfaces/cipher/i-key-storage.js'
import type {InternalMessage, MessagePart} from '../../../core/interfaces/cipher/message-types.js'

import {COMPACTED_TOOL_OUTPUT_PLACEHOLDER} from '../../../core/domain/cipher/storage/message-storage-types.js'

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
   */
  async pruneToolOutputs(options: PruneToolOutputsOptions): Promise<CompactionResult> {
    const {keepTokens = 40_000, sessionId} = options
    const session = await this.getSession(sessionId)

    if (!session || !session.newestMessageId) {
      return {compactedCount: 0, tokensSaved: 0}
    }

    // Collect all tool output parts, newest first
    const toolOutputParts: Array<{key: StorageKey; part: StoredPart}> = []

    // Traverse messages from newest to oldest
    let currentMessageId: string | undefined = session.newestMessageId
    while (currentMessageId) {
      // eslint-disable-next-line no-await-in-loop
      const storedMsg: StoredMessage | undefined = await this.keyStorage.get<StoredMessage>(
        this.messageKey(sessionId, currentMessageId),
      )
      if (!storedMsg) break

      // Collect tool output parts from this message
      for (const partId of storedMsg.partIds) {
        // eslint-disable-next-line no-await-in-loop
        const part = await this.keyStorage.get<StoredPart>(this.partKey(storedMsg.id, partId))
        if (part && part.type === 'tool_output' && !part.compactedAt) {
          toolOutputParts.push({
            key: this.partKey(storedMsg.id, partId),
            part,
          })
        }
      }

      currentMessageId = storedMsg.prevMessageId
    }

    // Estimate tokens (rough: 1 token ≈ 4 chars)
    let keptTokens = 0
    let compactedCount = 0
    let tokensSaved = 0
    const now = Date.now()

    for (const {key, part} of toolOutputParts) {
      const estimatedTokens = Math.ceil(part.content.length / 4)

      if (keptTokens < keepTokens) {
        keptTokens += estimatedTokens
      } else {
        // Mark this part as compacted
        // eslint-disable-next-line no-await-in-loop
        await this.keyStorage.set(key, {
          ...part,
          compactedAt: now,
          content: '', // Clear the content to save space
        })
        compactedCount++
        tokensSaved += estimatedTokens
      }
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
        if (part.compactedAt) {
          // Show placeholder for compacted parts
          contentParts.push({
            text: part.type === 'tool_output' ? COMPACTED_TOOL_OUTPUT_PLACEHOLDER : '[Content cleared]',
            type: 'text',
          })
        } else {
          switch (part.type) {
            case 'file': {
              contentParts.push({
                data: part.content,
                filename: part.filename,
                mimeType: part.mimeType || 'application/octet-stream',
                type: 'file',
              })

              break
            }

            case 'image': {
              contentParts.push({
                image: part.content,
                mimeType: part.mimeType,
                type: 'image',
              })

              break
            }

            case 'text': {
              contentParts.push({text: part.content, type: 'text'})

              break
            }

            case 'tool_output': {
              // Tool output becomes text content for tool messages
              content = part.content

              break
            }
          }
        }
      }

      // Only use content parts array if we have non-tool parts
      if (contentParts.length > 0 && message.role === 'user') {
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
        }
      }

      // For user messages, content is reconstructed from parts
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
}

/**
 * Factory function to create MessageStorageService.
 */
export function createMessageStorageService(keyStorage: IKeyStorage): MessageStorageService {
  return new MessageStorageService(keyStorage)
}
