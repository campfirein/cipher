/**
 * MessageList Component
 *
 * Composes activity logs and command messages into a unified list.
 */

import {Box, Text, useInput} from 'ink'
import React, {useEffect, useMemo, useState} from 'react'

import type {ActivityLog, CommandMessage} from '../types.js'

import {useCommands} from '../contexts/commands-context.js'
import {useAuth} from '../contexts/index.js'
import {useActivityLogs, useMode, useOnboarding, useOnboardingLogs, useTerminalBreakpoint, useUIHeights} from '../hooks/index.js'
import {InitView} from '../views/index.js'
import {CommandItem} from './command-item.js'
import {ExpandedCommandView} from './command/index.js'
import {ExpandedLogView} from './execution/expanded-log-view.js'
import {LogItem} from './execution/log-item.js'
import {List} from './list.js'
import {OnboardingItem} from './onboarding-item.js'
import {WelcomeBox} from './onboarding/welcome-box.js'

/**
 * Union type for message list items
 */
type MessageListItem =
  | {data: ActivityLog; timestamp: Date; type: 'log'}
  | {data: ActivityLog; timestamp: Date; type: 'onboarding'}
  | {data: CommandMessage; timestamp?: Date; type: 'command'}

interface MessageListProps {
  /** Index of the currently expanded item (null if none) */
  expandedIndex: null | number
  /** Available height for the list (in terminal rows) */
  height: number
  /** Callback when expanded index changes */
  onExpandedIndexChange: (index: null | number) => void
}

export const MessageList: React.FC<MessageListProps> = ({expandedIndex, height, onExpandedIndexChange}) => {
  const {logs: logsMessages} = useActivityLogs()
  const {logs: onboardingMessages} = useOnboardingLogs()
  const {activePrompt, messages: commandMessages} = useCommands()
  const {columns: terminalWidth} = useTerminalBreakpoint()
  const {mode} = useMode()
  const {completeInitFlow, isLoadingOnboardingCheck, shouldShowInit, shouldShowOnboarding} = useOnboarding()
  const {isLoadingUser} = useAuth()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const {messageItem} = useUIHeights()

  const messages = useMemo(() => {
    const onboardingItems: MessageListItem[] = onboardingMessages.map((log) => ({
      data: log,
      timestamp: log.timestamp,
      type: 'onboarding' as const,
    }))

    const logItems: MessageListItem[] = logsMessages
      .filter((log) => !onboardingMessages.some((ob) => ob.id === log.id))
      .map((log) => ({
        data: log,
        timestamp: log.timestamp,
        type: 'log' as const,
      }))

    const commandItems: MessageListItem[] = commandMessages.map((message) => ({
      data: message,
      timestamp: message.timestamp,
      type: 'command' as const,
    }))

    return [...onboardingItems, ...logItems, ...commandItems].sort((a, b) => {
      if (!a.timestamp) return 1
      if (!b.timestamp) return -1
      return a.timestamp.getTime() - b.timestamp.getTime()
    })
  }, [onboardingMessages, logsMessages, commandMessages])

  useEffect(() => {
    if (messages.length === 0) return
    setSelectedIndex(messages.length - 1)
  }, [messages.length])

  useInput((input, key) => {
    if (key.ctrl && input === 'o') {
      if (expandedIndex === selectedIndex) {
        onExpandedIndexChange(null)
      } else {
        onExpandedIndexChange(selectedIndex)
      }
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1))
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(prev + 1, messages.length - 1))
    }

    if (key.escape && expandedIndex !== null) {
      onExpandedIndexChange(null)
    }
  }, {isActive: mode === 'main' && messages.length > 0 && expandedIndex === null && !shouldShowOnboarding && !activePrompt})
  
  // Get the expanded message based on expandedIndex
  const expandedMessage = expandedIndex === null ? null : messages[expandedIndex]

  if (isLoadingUser || isLoadingOnboardingCheck) {
    return null
  }

  if (messages.length === 0 && shouldShowOnboarding) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold>Welcome to ByteRover.</Text>
      </Box>
    )
  }

  if (shouldShowInit) {
    return <InitView availableHeight={height} onInitComplete={completeInitFlow} />
  }

  if (messages.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <WelcomeBox isCopyActive={false} />
      </Box>
    )
  }

  if (expandedMessage && (expandedMessage.type === 'log' || expandedMessage.type === 'onboarding')) {
    return (
      <ExpandedLogView
        availableHeight={height}
        isActive={mode === 'main'}
        log={expandedMessage.data}
        onClose={() => onExpandedIndexChange(null)}
      />
    )
  }

  if (expandedMessage && expandedMessage.type === 'command') {
    return (
      <ExpandedCommandView
        availableHeight={height}
        isActive={mode === 'main'}
        message={expandedMessage.data}
        onClose={() => onExpandedIndexChange(null)}
        terminalWidth={terminalWidth}
      />
    )
  }

  return (
    <List height={height} selectedIndex={selectedIndex}>
      {messages.map((item, index) => {
        const key = (() => {
          const timestamp = item.timestamp?.getTime() ?? 0
          if (item.type === 'command') return `command-${item.data.fromCommand}-${timestamp}-${index}`
          if (item.type === 'onboarding') return `onboarding-${item.data.type}-${timestamp}-${index}`
          return `log-${item.data.id}-${timestamp}-${index}`
        })()

        if (item.type === 'command') {
          return (
            <Box key={key}>
              <CommandItem
                isLastMessage={index === messages.length - 1}
                isSelected={selectedIndex === index}
                message={item.data}
                terminalWidth={terminalWidth}
              />
            </Box>
          )
        }

        if (item.type === 'onboarding') {
          return (
            <Box key={key}>
              <OnboardingItem
                isSelected={selectedIndex === index}
                log={item.data}
                shouldShowExpand={!shouldShowOnboarding}
              />
            </Box>
          )
        }

        return (
          <Box key={key}>
            <LogItem
              heights={{
                ...messageItem,
                maxContentLines: 2
              }}
              isSelected={selectedIndex === index}
              log={item.data}
            />
          </Box>
        )
      })}
    </List>
  )
}
