/**
 * Command View
 *
 * Main view with slash command input and streaming output support.
 */

import type {ScrollViewRef} from 'ink-scroll-view'

import {Box, Spacer, Text, useApp, useInput, useStdout} from 'ink'
import {ScrollView} from 'ink-scroll-view'
import TextInput from 'ink-text-input'
import React, {useCallback, useEffect, useRef, useState} from 'react'

import type {CommandMessage, PromptRequest, StreamingMessage} from '../types.js'

import {MessageItem, Suggestions} from '../components/index.js'
import {InlineConfirm, InlineSearch, InlineSelect} from '../components/inline-prompts/index.js'
import {useCommands, useMode, useTheme} from '../hooks/index.js'

export const CommandView: React.FC = () => {
  const {exit} = useApp()
  const [command, setCommand] = useState('')
  const [inputKey, setInputKey] = useState(0)
  const [messages, setMessages] = useState<CommandMessage[]>([])
  const [streamingMessages, setStreamingMessages] = useState<StreamingMessage[]>([])
  const [activePrompt, setActivePrompt] = useState<null | PromptRequest>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const {
    theme: {colors},
  } = useTheme()
  const {handleSlashCommand} = useCommands()
  const {appendShortcuts, mode, removeShortcuts} = useMode()
  const scrollRef = useRef<ScrollViewRef>(null)
  const {stdout} = useStdout()

  useEffect(() => {
    const handleResize = () => scrollRef.current?.remeasure()
    stdout?.on('resize', handleResize)
    return () => {
      stdout?.off('resize', handleResize)
    }
  }, [stdout])

  // Append shortcuts for prompts
  useEffect(() => {
    if (activePrompt?.type === 'search' || activePrompt?.type === 'select') {
      appendShortcuts([{description: 'select', key: 'enter'}])

      return () => {
        // Note: We can't easily track the specific shortcuts we added,
        // but the removeShortcuts function will remove any shortcuts with key 'enter'
        removeShortcuts(['enter'])
      }
    }
  }, [activePrompt?.type, appendShortcuts, removeShortcuts])

  // Scroll handling - only when not in prompt mode
  useInput(
    (_input, key) => {
      const scroll = scrollRef.current
      if (!scroll) return

      const currentOffset = scroll.getScrollOffset()
      const contentHeight = scroll.getContentHeight()
      const viewportHeight = scroll.getViewportHeight()

      // Only scroll up if not at the top
      if (key.upArrow && currentOffset > 0) {
        scroll.scrollBy(-2)
      }

      // Only scroll down if not at the bottom
      if (key.downArrow && currentOffset + viewportHeight < contentHeight) {
        scroll.scrollBy(2)
      }
    },
    {isActive: mode === 'console' && !activePrompt && !isStreaming},
  )

  const executeCommand = useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) return

      // Clear command input immediately
      setCommand('')
      setMessages((prev) => [
        ...prev,
        {
          content: '',
          fromCommand: trimmed,
          timestamp: new Date(),
          type: 'command',
        },
      ])

      const result = await handleSlashCommand(trimmed)

      if (result && result.type === 'clear') {
        setMessages([])
        setStreamingMessages([])
      }

      if (result && result.type === 'message') {
        setMessages((prev) => [
          ...prev,
          {
            content: result.content,
            fromCommand: trimmed,
            type: result.messageType === 'error' ? 'error' : 'info',
          },
        ])
      }

      if (result && result.type === 'quit') {
        exit()
      }

      if (result && result.type === 'streaming') {
        setIsStreaming(true)
        setStreamingMessages([])

        const collectedMessages: StreamingMessage[] = []

        const onMessage = (msg: StreamingMessage) => {
          collectedMessages.push(msg)
          setStreamingMessages((prev) => [...prev, msg])
        }

        const onPrompt = (prompt: PromptRequest) => {
          setActivePrompt(prompt)
        }

        try {
          await result.execute(onMessage, onPrompt)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          const errorMsg: StreamingMessage = {
            content: `Error: ${errorMessage}`,
            id: `error-${Date.now()}`,
            type: 'error',
          }
          collectedMessages.push(errorMsg)
          setStreamingMessages((prev) => [...prev, errorMsg])
        } finally {
          // Store output with the command message
          setMessages((prev) => {
            const updated = [...prev]
            const lastIndex = updated.length - 1
            if (lastIndex >= 0 && updated[lastIndex].type === 'command') {
              updated[lastIndex] = {...updated[lastIndex], output: collectedMessages}
            }

            return updated
          })
          setStreamingMessages([])
          setIsStreaming(false)
          setActivePrompt(null)
        }
      }
    },
    [exit, handleSlashCommand],
  )

  useEffect(() => {
    if (messages.length > 0 || streamingMessages.length > 0) {
      scrollRef.current?.scrollToBottom()
    }
  }, [messages.length, streamingMessages.length])

  const handleSubmit = useCallback(
    async (value: string) => {
      if (mode === 'console' && !isStreaming) await executeCommand(value)
    },
    [executeCommand, isStreaming, mode],
  )

  const handleSelect = useCallback(
    async (value: string) => {
      if (!isStreaming) await executeCommand(value)
    },
    [executeCommand, isStreaming],
  )

  const handleInsert = useCallback((value: string) => {
    setCommand(value + ' ')
    // TRICK: Force TextInput to remount with cursor at the end
    setInputKey((prev) => prev + 1)
  }, [])

  // Handle prompt response
  const handleSearchResponse = useCallback(
    (value: unknown) => {
      if (activePrompt?.type === 'search') {
        activePrompt.onResponse(value)
        setActivePrompt(null)
      }
    },
    [activePrompt],
  )

  const handleConfirmResponse = useCallback(
    (value: boolean) => {
      if (activePrompt?.type === 'confirm') {
        activePrompt.onResponse(value)
        setActivePrompt(null)
      }
    },
    [activePrompt],
  )

  const handleSelectResponse = useCallback(
    (value: unknown) => {
      if (activePrompt?.type === 'select') {
        activePrompt.onResponse(value)
        setActivePrompt(null)
      }
    },
    [activePrompt],
  )

  // Render streaming message
  const renderStreamingMessage = (msg: StreamingMessage) => {
    let color = colors.text
    if (msg.type === 'error') color = colors.errorText
    if (msg.type === 'warning') color = colors.warning

    return (
      <Text color={color} key={msg.id}>
        {msg.content}
      </Text>
    )
  }

  return (
    <Box flexDirection="column" height="100%" width="100%">
      {/* Messages - Scrollable area */}
      {messages.length > 0 || streamingMessages.length > 0 || activePrompt ? (
        <Box flexDirection="column" flexGrow={1} paddingX={2}>
          <ScrollView ref={scrollRef}>
            <Box flexDirection="column" width="100%">
              {/* Regular messages */}
              {messages.map((msg, index) => {
                if (msg.type === 'command') {
                  const hasOutput = msg.output && msg.output.length > 0
                  return (
                    <Box flexDirection="column" key={index} marginTop={index === 0 ? 0 : 1} width="100%">
                      <Box
                        borderBottom={false}
                        borderLeftColor={colors.primary}
                        borderRight={false}
                        borderStyle="bold"
                        borderTop={false}
                        paddingLeft={1}
                      >
                        <Text color={colors.text} dimColor>
                          {msg.fromCommand} <Text wrap="truncate-end">{msg.content}</Text>
                        </Text>
                      </Box>
                      {/* Command output */}
                      {hasOutput && (
                        <Box
                          borderColor={colors.border}
                          borderStyle="round"
                          flexDirection="column"
                          marginTop={0}
                          paddingX={1}
                          width="100%"
                        >
                          {msg.output!.map((streamMsg) => renderStreamingMessage(streamMsg))}
                        </Box>
                      )}
                    </Box>
                  )
                }

                return <MessageItem key={index} message={msg} />
              })}

              {/* Output box for streaming/result messages */}
              {(streamingMessages.length > 0 || activePrompt) && (
                <Box
                  // backgroundColor={colors.bg2}
                  borderColor={colors.border}
                  borderStyle="round"
                  flexDirection="column"
                  paddingX={1}
                  paddingY={0}
                  width="100%"
                >
                  {streamingMessages.map((streamMsg) => renderStreamingMessage(streamMsg))}
                  {/* Active prompt */}
                  {activePrompt?.type === 'search' && (
                    <InlineSearch
                      message={activePrompt.message}
                      onSelect={handleSearchResponse}
                      source={activePrompt.source}
                    />
                  )}
                  {activePrompt?.type === 'confirm' && (
                    <InlineConfirm
                      default={activePrompt.default}
                      message={activePrompt.message}
                      onConfirm={handleConfirmResponse}
                    />
                  )}
                  {activePrompt?.type === 'select' && (
                    <InlineSelect
                      choices={activePrompt.choices}
                      message={activePrompt.message}
                      onSelect={handleSelectResponse}
                    />
                  )}
                </Box>
              )}
            </Box>
          </ScrollView>
        </Box>
      ) : (
        <Spacer />
      )}

      {/* Fixed bottom area: Suggestions + Input */}
      <Box flexDirection="column" flexShrink={0}>
        {/* Suggestions - hide during streaming */}
        {!isStreaming && !activePrompt && (
          <Suggestions input={command} onInsert={handleInsert} onSelect={handleSelect} />
        )}

        {/* Command input */}
        <Box borderColor={colors.border} borderLeft={false} borderRight={false} borderStyle="single" paddingX={2}>
          <Text color={colors.primary}>{'> '}</Text>
          <TextInput
            focus={!activePrompt && (mode === 'console' || mode === 'suggestions')}
            key={inputKey}
            onChange={setCommand}
            onSubmit={handleSubmit}
            placeholder={isStreaming ? 'Command running...' : 'Use / to view commands'}
            value={command}
          />
        </Box>
      </Box>
    </Box>
  )
}
