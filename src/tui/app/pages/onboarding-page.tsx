/**
 * OnboardingPage
 *
 * Onboarding flow page for first-time CLI users.
 * Shows welcome message and guides through curate → query → explore steps.
 */

import {Box, Text} from 'ink'
import React, {useMemo} from 'react'

import type {ActivityLog, CommandMessage} from '../../types/index.js'

import {CommandItem, List, LogItem} from '../../components/index.js'
import {OnboardingItem} from '../../components/onboarding-item.js'
import {
  useActivityLogs,
  useCommands,
  useOnboardingLogs,
  useTerminalBreakpoint,
  useUIHeights,
} from '../../hooks/index.js'
import {MainLayout} from '../layouts/main-layout.js'

/**
 * Union type for activity feed items
 */
type ActivityFeedItem =
  | {data: ActivityLog; timestamp: Date; type: 'log'}
  | {data: ActivityLog; timestamp: Date; type: 'onboarding'}
  | {data: CommandMessage; timestamp?: Date; type: 'command'}

export function OnboardingPage(): React.ReactNode {
  const {columns: terminalWidth, rows: terminalHeight} = useTerminalBreakpoint()
  const {footer, header, messageItem} = useUIHeights()
  const {logs: logsMessages} = useActivityLogs()
  const {logs: onboardingMessages} = useOnboardingLogs()
  const {messages: commandMessages} = useCommands()

  const contentHeight = Math.max(1, terminalHeight - header - footer)
  const inputHeight = 3
  const listHeight = Math.max(1, contentHeight - inputHeight)

  // Build activity feed items
  const feedItems = useMemo(() => {
    const onboardingItems: ActivityFeedItem[] = onboardingMessages.map((log) => ({
      data: log,
      timestamp: log.timestamp,
      type: 'onboarding' as const,
    }))

    const logItems: ActivityFeedItem[] = logsMessages
      .filter((log) => !onboardingMessages.some((ob) => ob.id === log.id))
      .map((log) => ({
        data: log,
        timestamp: log.timestamp,
        type: 'log' as const,
      }))

    const commandItems: ActivityFeedItem[] = commandMessages.map((message) => ({
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

  // Welcome message when no activity yet
  if (feedItems.length === 0) {
    return (
      <MainLayout showInput>
        <Box flexDirection="column" flexGrow={1}>
          <Text bold>Welcome to ByteRover.</Text>
        </Box>
      </MainLayout>
    )
  }

  // Activity feed during onboarding
  return (
    <MainLayout showInput>
      <List height={listHeight} selectedIndex={feedItems.length - 1}>
        {feedItems.map((item, index) => {
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
                  isLastMessage={index === feedItems.length - 1}
                  isSelected={false}
                  message={item.data}
                  terminalWidth={terminalWidth}
                />
              </Box>
            )
          }

          if (item.type === 'onboarding') {
            return (
              <Box key={key}>
                <OnboardingItem isSelected={false} log={item.data} shouldShowExpand={false} />
              </Box>
            )
          }

          return (
            <Box key={key}>
              <LogItem
                heights={{
                  ...messageItem,
                  maxContentLines: 2,
                }}
                isSelected={false}
                log={item.data}
              />
            </Box>
          )
        })}
      </List>
    </MainLayout>
  )
}
