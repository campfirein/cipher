import {randomUUID} from 'node:crypto'

import type {SessionEventBus} from '../events/event-emitter.js'
import type {FileData, ImageData} from '../llm/context/context-manager.js'

/**
 * A message that has been queued for later processing.
 */
export interface QueuedMessage {
  /** Message text content */
  content: string
  /** Optional file attachment */
  fileData?: FileData
  /** Unique identifier for this queued message */
  id: string
  /** Optional image attachment */
  imageData?: ImageData
  /** Timestamp when the message was queued */
  queuedAt: number
}

/**
 * Service for buffering user messages when a session is busy executing.
 *
 * When the LLM is processing a request, new messages from the user are
 * queued and coalesced into a single input when the session becomes available.
 *
 * This improves UX by allowing users to add context while waiting for responses.
 */
export class MessageQueueService {
  private readonly eventBus?: SessionEventBus
  private readonly queue: QueuedMessage[] = []

  /**
   * Creates a new message queue service.
   *
   * @param eventBus - Optional session event bus for queue events
   */
  constructor(eventBus?: SessionEventBus) {
    this.eventBus = eventBus
  }

  /**
   * Clear all queued messages without processing.
   */
  public clear(): void {
    this.queue.length = 0
  }

  /**
   * Dequeue all messages and coalesce into single input.
   * Messages are combined intelligently based on count.
   *
   * @returns Coalesced content with images/files, or null if queue is empty
   */
  public dequeueAll(): null | {content: string; files: FileData[]; images: ImageData[]} {
    if (this.queue.length === 0) {
      return null
    }

    const messages = [...this.queue]
    this.queue.length = 0

    this.eventBus?.emit('message:dequeued', {count: messages.length})

    // Collect all attachments
    const images: ImageData[] = []
    const files: FileData[] = []

    for (const msg of messages) {
      if (msg.imageData) images.push(msg.imageData)
      if (msg.fileData) files.push(msg.fileData)
    }

    // Coalesce message content based on count
    let content: string
    if (messages.length === 1) {
      content = messages[0].content
    } else if (messages.length === 2) {
      content = `First: ${messages[0].content}\n\nAlso: ${messages[1].content}`
    } else {
      content = messages.map((m, i) => `[${i + 1}]: ${m.content}`).join('\n\n')
    }

    return {content, files, images}
  }

  /**
   * Queue a message for later processing.
   *
   * @param message - Message to queue (without id and queuedAt)
   * @returns Queue position (1-based)
   */
  public enqueue(message: Omit<QueuedMessage, 'id' | 'queuedAt'>): number {
    const queued: QueuedMessage = {
      ...message,
      id: randomUUID(),
      queuedAt: Date.now(),
    }
    this.queue.push(queued)
    this.eventBus?.emit('message:queued', {message: queued, position: this.queue.length})
    return this.queue.length
  }

  /**
   * Check if there are pending messages in the queue.
   */
  public hasPending(): boolean {
    return this.queue.length > 0
  }

  /**
   * Get the number of pending messages.
   */
  public pendingCount(): number {
    return this.queue.length
  }
}
