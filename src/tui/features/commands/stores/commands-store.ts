/**
 * Commands Store
 *
 * Zustand store for slash command state: messages, streaming, dialogs.
 * Command definitions and execution are handled by useCommandsController hook.
 */

import {create} from 'zustand'

import type {CommandMessage, StreamingMessage} from '../../../types/messages.js'

export interface CommandsState {
  /** Whether a dialog command is currently active (blocks input focus and feed navigation) */
  hasActiveDialog: boolean
  /** Whether a command is currently streaming output */
  isStreaming: boolean
  /** Command messages for display */
  messages: CommandMessage[]
  /** Streaming messages for live output */
  streamingMessages: StreamingMessage[]
}

export interface CommandsActions {
  /** Add a command message */
  addMessage: (message: CommandMessage) => void
  /** Clear all messages */
  clearMessages: () => void
  /** Set whether a dialog command is active */
  setHasActiveDialog: (hasActiveDialog: boolean) => void
  /** Set streaming state */
  setIsStreaming: (isStreaming: boolean) => void
  /** Set messages directly */
  setMessages: (messages: ((prev: CommandMessage[]) => CommandMessage[]) | CommandMessage[]) => void
  /** Set streaming messages directly */
  setStreamingMessages: (messages: ((prev: StreamingMessage[]) => StreamingMessage[]) | StreamingMessage[]) => void
}

export const useCommandsStore = create<CommandsActions & CommandsState>()((set) => ({
  addMessage: (message) => set((state) => ({messages: [...state.messages, message]})),

  clearMessages: () => set({hasActiveDialog: false, isStreaming: false, messages: [], streamingMessages: []}),

  hasActiveDialog: false,

  isStreaming: false,

  messages: [],

  setHasActiveDialog: (hasActiveDialog) => set({hasActiveDialog}),

  setIsStreaming: (isStreaming) => set({isStreaming}),

  setMessages: (messagesOrFn) =>
    set((state) => ({
      messages: typeof messagesOrFn === 'function' ? messagesOrFn(state.messages) : messagesOrFn,
    })),

  setStreamingMessages: (messagesOrFn) =>
    set((state) => ({
      streamingMessages: typeof messagesOrFn === 'function' ? messagesOrFn(state.streamingMessages) : messagesOrFn,
    })),

  streamingMessages: [],
}))
