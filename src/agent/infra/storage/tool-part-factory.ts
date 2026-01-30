/**
 * Factory for creating and managing tool parts with state machine.
 *
 * This module provides utilities for:
 * - Creating tool parts in pending state
 * - Transitioning tool parts through their lifecycle (pending → running → completed/error)
 * - Marking tool parts as compacted for pruning
 *
 * Based on OpenCode's tool state machine pattern.
 */

import {randomUUID} from 'node:crypto'

import type {StoredPart, StoredToolState} from '../../core/domain/storage/message-storage-types.js'
import type {AttachmentPart} from '../../core/interfaces/message-types.js'

/**
 * Options for creating a completed tool state.
 */
export interface ToolCompletionOptions {
  /** Attachments produced by the tool (images, files) */
  attachments?: AttachmentPart[]
  /** Additional metadata about the execution */
  metadata?: Record<string, unknown>
  /** Human-readable title for display */
  title?: string
}

/**
 * Factory for creating and managing tool parts with state machine.
 *
 * Tool parts track the full lifecycle of a tool call:
 * 1. Pending: Tool call received from LLM, not yet started
 * 2. Running: Execution has started
 * 3. Completed: Execution finished successfully with output
 * 4. Error: Execution failed with error message
 *
 * This enables:
 * - Real-time UI feedback during tool execution
 * - Better conversation history representation
 * - Efficient compaction (mark individual outputs as compacted)
 */
export const ToolPartFactory = {
  /**
   * Create a new tool part in pending state.
   *
   * @param messageId - ID of the message this part belongs to
   * @param callId - Unique identifier for this tool call
   * @param toolName - Name of the tool being called
   * @param input - Parsed input arguments
   * @returns StoredPart with pending tool state
   */
  createPending(
    messageId: string,
    callId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): StoredPart {
    const now = Date.now()
    return {
      content: '', // Tool parts store state in toolState, not content
      createdAt: now,
      id: randomUUID(),
      messageId,
      toolName,
      toolState: {
        callId,
        input,
        status: 'pending',
      },
      type: 'tool',
    }
  },

  /**
   * Mark a tool part as compacted.
   * Clears the output while preserving the state structure.
   *
   * @param part - The tool part to mark as compacted
   * @returns Updated StoredPart with compactedAt timestamp
   */
  markCompacted(part: StoredPart): StoredPart {
    if (part.type !== 'tool' || !part.toolState) {
      throw new Error('Cannot mark non-tool part as compacted')
    }

    const now = Date.now()
    return {
      ...part,
      compactedAt: now,
      toolState: {
        ...part.toolState,
        // Clear output but keep other state for reference
        output: part.toolState.output ? '[Compacted]' : undefined,
      },
    }
  },

  /**
   * Convert a StoredPart's tool state to the format used in message-types.ts.
   * Useful for reconstructing InternalMessage from stored parts.
   *
   * @param toolState - The stored tool state
   * @returns Tool state in the format expected by ToolPart
   */
  toToolPartState(
    toolState: StoredToolState,
  ):
    | {
        attachments?: AttachmentPart[]
        compactedAt?: number
        input: Record<string, unknown>
        metadata?: Record<string, unknown>
        output: string
        status: 'completed'
        time: {end: number; start: number}
        title?: string
      }
    | {error: string; input: Record<string, unknown>; status: 'error'; time: {end: number; start: number}}
    | {input: Record<string, unknown>; startedAt: number; status: 'running'}
    | {input: Record<string, unknown>; status: 'pending'} {
    const input = toolState.input ?? {}

    switch (toolState.status) {
      case 'completed': {
        return {
          attachments: toolState.attachments?.map((att) => ({
            data: att.data,
            filename: att.filename,
            mime: att.mime,
            type: att.type,
          })),
          input,
          output: toolState.output ?? '',
          status: 'completed',
          time: {
            end: toolState.completedAt ?? Date.now(),
            start: toolState.startedAt ?? Date.now(),
          },
          title: toolState.title,
        }
      }

      case 'error': {
        return {
          error: toolState.error ?? 'Unknown error',
          input,
          status: 'error',
          time: {
            end: toolState.completedAt ?? Date.now(),
            start: toolState.startedAt ?? Date.now(),
          },
        }
      }

      case 'pending': {
        return {input, status: 'pending'}
      }

      case 'running': {
        return {
          input,
          startedAt: toolState.startedAt ?? Date.now(),
          status: 'running',
        }
      }
    }
  },

  /**
   * Transition a tool part to completed state.
   *
   * @param part - The tool part to update
   * @param output - Tool output content
   * @param options - Additional options (title, metadata, attachments)
   * @returns Updated StoredPart with completed state
   */
  transitionToCompleted(part: StoredPart, output: string, options?: ToolCompletionOptions): StoredPart {
    if (part.type !== 'tool' || !part.toolState) {
      throw new Error('Cannot transition non-tool part to completed')
    }

    const now = Date.now()

    return {
      ...part,
      toolState: {
        ...part.toolState,
        attachments: options?.attachments?.map((att) => ({
          data: att.data,
          filename: att.filename,
          mime: att.mime,
          type: att.type,
        })),
        completedAt: now,
        output,
        status: 'completed',
        title: options?.title,
      },
    }
  },

  /**
   * Transition a tool part to error state.
   *
   * @param part - The tool part to update
   * @param error - Error message
   * @returns Updated StoredPart with error state
   */
  transitionToError(part: StoredPart, error: string): StoredPart {
    if (part.type !== 'tool' || !part.toolState) {
      throw new Error('Cannot transition non-tool part to error')
    }

    const now = Date.now()

    return {
      ...part,
      toolState: {
        ...part.toolState,
        completedAt: now,
        error,
        status: 'error',
      },
    }
  },

  /**
   * Transition a tool part to running state.
   *
   * @param part - The tool part to update
   * @returns Updated StoredPart with running state
   */
  transitionToRunning(part: StoredPart): StoredPart {
    if (part.type !== 'tool' || !part.toolState) {
      throw new Error('Cannot transition non-tool part to running')
    }

    const now = Date.now()
    return {
      ...part,
      toolState: {
        ...part.toolState,
        startedAt: now,
        status: 'running',
      },
    }
  },
}
