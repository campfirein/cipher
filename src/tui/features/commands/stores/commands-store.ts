/**
 * Commands Store
 *
 * Zustand store for slash command state: messages, prompts, streaming.
 * Command definitions and execution are handled by useCommandsController hook.
 */

import {create} from 'zustand'

import type {CommandMessage, StreamingMessage} from '../../../types/messages.js'
import type {PromptRequest} from '../../../types/prompts.js'

export interface CommandsState {
  /** Active inline prompt request */
  activePrompt: null | PromptRequest
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
  /** Set the active prompt */
  setActivePrompt: (prompt: null | PromptRequest) => void
  /** Set streaming state */
  setIsStreaming: (isStreaming: boolean) => void
  /** Set messages directly */
  setMessages: (messages: ((prev: CommandMessage[]) => CommandMessage[]) | CommandMessage[]) => void
  /** Set streaming messages directly */
  setStreamingMessages: (messages: ((prev: StreamingMessage[]) => StreamingMessage[]) | StreamingMessage[]) => void
}

export const useCommandsStore = create<CommandsActions & CommandsState>()((set) => ({
  activePrompt: null,

  addMessage: (message) => set((state) => ({messages: [...state.messages, message]})),

  clearMessages: () => set({activePrompt: null, isStreaming: false, messages: [], streamingMessages: []}),

  isStreaming: false,

  messages: [],

  setActivePrompt: (prompt) => set({activePrompt: prompt}),

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
