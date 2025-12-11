/**
 * Home View
 *
 * Main view with slash command input
 */

import type { ScrollViewRef } from 'ink-scroll-view'

import { Box, Spacer, Text, useApp, useInput, useStdout } from 'ink'
import { ScrollView } from 'ink-scroll-view'
import TextInput from 'ink-text-input'
import React, { useEffect, useRef, useState } from 'react'

import type { CommandMessage } from '../types.js'

import { MessageItem, Suggestions } from '../components/index.js'
import { useCommands, useMode, useTheme } from '../hooks/index.js'

export const CommandView: React.FC = () => {
  const { exit } = useApp()
  const [command, setCommand] = useState('')
  const [inputKey, setInputKey] = useState(0)
  const [messages, setMessages] = useState<CommandMessage[]>([])
  const { theme: { colors } } = useTheme()
  const { handleSlashCommand } = useCommands()
  const { mode } = useMode()
  const scrollRef = useRef<ScrollViewRef>(null)
  const { stdout } = useStdout()

  useEffect(() => {
    const handleResize = () => scrollRef.current?.remeasure()
    stdout?.on('resize', handleResize)
    return () => {
      stdout?.off('resize', handleResize)
    }
  }, [stdout])

  useInput((_input, key) => {
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
  }, { isActive: mode === 'console' })

  const executeCommand = async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return

    const result = await handleSlashCommand(trimmed)

    if (result && result.type === 'clear') {
      setMessages([])
    }

    if (result && result.type === 'message') {
      setMessages((prev) => [...prev, {
        content: result.content,
        fromCommand: trimmed,
        type: result.messageType === 'error' ? 'error' : 'info',
      }])
    }

    if (result && result.type === 'quit') {
      exit()
    }

    setCommand('')
  }

  useEffect(() => {
    if (messages.length > 0) {
      scrollRef.current?.scrollToBottom()
    }
  }, [messages.length])

  const handleSubmit = async (value: string) => {
    if (mode === 'console') await executeCommand(value)
  }

  const handleSelect = async (value: string) => {
    await executeCommand(value)
  }

  const handleInsert = (value: string) => {
    setCommand(value + ' ')
    // TRICK: Force TextInput to remount with cursor at the end
    setInputKey((prev) => prev + 1)
  }

  return (
    <Box flexDirection="column" height="100%" width="100%">
      {/* Messages - Scrollable area */}
      {messages.length > 0 ? (
        <Box flexDirection="column" flexGrow={1} paddingX={2}>
          <ScrollView ref={scrollRef}>
            {messages.map((msg, index) => (
              <MessageItem key={index} message={msg} />
            ))}
          </ScrollView>
        </Box>
      ) : (
        <Spacer />
      )}

      {/* Fixed bottom area: Suggestions + Input */}
      <Box flexDirection="column" flexShrink={0}>
        {/* Suggestions */}
        <Suggestions input={command} onInsert={handleInsert} onSelect={handleSelect} />

        {/* Command input */}
        <Box borderColor={colors.border} borderLeft={false} borderRight={false} borderStyle="single" paddingX={2}>
          <Text color={colors.primary}>{"> "}</Text>
          <TextInput
            key={inputKey}
            onChange={setCommand}
            onSubmit={handleSubmit}
            placeholder="Use / to view commands"
            value={command}
          />
        </Box>
      </Box>
    </Box>
  )
}
