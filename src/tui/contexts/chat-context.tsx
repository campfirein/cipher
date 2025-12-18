/**
 * Chat Context
 *
 * Manages persistent chat mode with Cipher agent.
 * Agent stays alive between /exit and /chat for instant re-entry.
 */

import {randomUUID} from 'node:crypto'

import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react'

import type {StreamingEvent} from '../../core/domain/cipher/streaming/types.js'
import type {ICipherAgent} from '../../core/interfaces/cipher/i-cipher-agent.js'

import {getCurrentConfig} from '../../config/environment.js'
import {PROJECT} from '../../constants.js'
import {CipherAgent} from '../../infra/cipher/agent/index.js'
import {useAuth} from './auth-context.js'
import {useServices} from './services-context.js'

export interface ChatContextValue {
  /** Reference to the agent for event bus access if needed */
  agent: ICipherAgent | null
  /** Cancel current running chat */
  cancelCurrentRun: () => void
  /** Enter chat mode - creates agent if needed */
  enterChatMode: () => Promise<void>
  /** Exit chat mode - keeps agent alive for fast re-entry */
  exitChatMode: () => void
  /** Whether currently in chat mode */
  isInChatMode: boolean
  /** Whether a message is being processed */
  isProcessing: boolean
  /** Send a message and get streaming iterator */
  sendMessage: (input: string) => Promise<AsyncIterableIterator<StreamingEvent>>
  /** Current session ID */
  sessionId: string | null
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined)

interface ChatProviderProps {
  children: React.ReactNode
}

export function ChatProvider({children}: ChatProviderProps): React.ReactElement {
  const {authToken, brvConfig} = useAuth()
  const {tokenStore} = useServices()

  // State
  const [agent, setAgent] = useState<CipherAgent | null>(null)
  const [isInChatMode, setIsInChatMode] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  // Refs for cancellation
  const abortControllerRef = useRef<AbortController | null>(null)

  /**
   * Create agent configuration from auth context
   */
  const createAgentConfig = useCallback(() => {
    if (!authToken) {
      throw new Error('Authentication required for chat mode')
    }

    const envConfig = getCurrentConfig()

    return {
      accessToken: authToken.accessToken,
      apiBaseUrl: envConfig.llmApiBaseUrl,
      fileSystem: {workingDirectory: process.cwd()},
      llm: {
        maxIterations: 10,
        maxTokens: 4096,
        temperature: 0.7,
        topK: 10,
        topP: 0.95,
        verbose: false,
      },
      model: 'gemini-2.5-pro',
      projectId: PROJECT,
      sessionKey: authToken.sessionKey,
    }
  }, [authToken])

  /**
   * Enter chat mode - creates agent if not exists
   */
  const enterChatMode = useCallback(async () => {
    // Already in chat mode with agent
    if (agent && sessionId) {
      setIsInChatMode(true)
      return
    }

    if (!authToken || !brvConfig) {
      throw new Error('Authentication and project initialization required for chat mode')
    }

    // Create new agent
    const config = createAgentConfig()
    const newAgent = new CipherAgent(config, brvConfig)
    await newAgent.start()

    // Create persistent session
    const chatSessionId = `chat-${randomUUID()}`
    await newAgent.createSession(chatSessionId)

    setAgent(newAgent)
    setSessionId(chatSessionId)
    setIsInChatMode(true)
  }, [agent, sessionId, authToken, brvConfig, createAgentConfig])

  /**
   * Exit chat mode - keeps agent alive for fast re-entry
   */
  const exitChatMode = useCallback(() => {
    setIsInChatMode(false)
    // Agent and session stay alive for instant re-entry
  }, [])

  /**
   * Send a message to the agent
   */
  const sendMessage = useCallback(
    async (input: string): Promise<AsyncIterableIterator<StreamingEvent>> => {
      if (!agent || !sessionId) {
        throw new Error('Chat mode not initialized. Call enterChatMode() first.')
      }

      // Create abort controller for this message
      abortControllerRef.current = new AbortController()
      setIsProcessing(true)

      try {
        const iterator = await agent.stream(input, sessionId, {
          executionContext: {commandType: 'chat'},
          signal: abortControllerRef.current.signal,
        })

        // Wrap iterator to handle cleanup
        const wrappedIterator: AsyncIterableIterator<StreamingEvent> = {
          [Symbol.asyncIterator]() {
            return this
          },
          async next() {
            const result = await iterator.next()
            if (result.done) {
              setIsProcessing(false)
            }
            return result
          },
          async return() {
            setIsProcessing(false)
            if (iterator.return) {
              return iterator.return()
            }
            return {done: true, value: undefined}
          },
        }

        return wrappedIterator
      } catch (error) {
        setIsProcessing(false)
        throw error
      }
    },
    [agent, sessionId],
  )

  /**
   * Cancel current running chat
   */
  const cancelCurrentRun = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    if (agent && sessionId) {
      agent.cancel(sessionId).catch(() => {
        // Ignore cancel errors
      })
    }
    setIsProcessing(false)
  }, [agent, sessionId])

  // Cleanup on unmount - stop agent
  useEffect(() => {
    return () => {
      if (agent) {
        agent.stop().catch(() => {
          // Ignore cleanup errors
        })
      }
    }
  }, [agent])

  // Memoize context value
  const value = useMemo(
    () => ({
      agent,
      cancelCurrentRun,
      enterChatMode,
      exitChatMode,
      isInChatMode,
      isProcessing,
      sendMessage,
      sessionId,
    }),
    [agent, cancelCurrentRun, enterChatMode, exitChatMode, isInChatMode, isProcessing, sendMessage, sessionId],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChat must be used within ChatProvider')
  }

  return context
}
