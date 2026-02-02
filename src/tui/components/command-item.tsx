/**
 * CommandMessageItem Component
 *
 * Renders a command message with its output directly, without converting to BaseListItem.
 */

import {Box, Spacer, Text} from 'ink'
import React from 'react'

import type {CommandMessage} from '../types/index.js'

import {useCommands, useTheme} from '../hooks/index.js'
import {formatTime} from '../utils/index.js'
import {CommandOutput, LiveStreamingOutput} from './command/index.js'
import {MessageItem} from './message-item.js'

export interface CommandItemProps {
  isLastMessage: boolean
  isSelected?: boolean
  message: CommandMessage
  terminalWidth: number
}

export const CommandItem: React.FC<CommandItemProps> = ({isLastMessage, isSelected, message, terminalWidth}) => {
  const {activePrompt, isStreaming, streamingMessages} = useCommands()
  const {
    theme: {colors},
  } = useTheme()
  const hasCompletedOutput = message.output && message.output.length > 0
  const showLiveOutput =
    isLastMessage && (isStreaming || activePrompt) && (streamingMessages.length > 0 || activePrompt)

  if (message.type === 'error') {
    return <MessageItem isSelected={isSelected} message={message} />
  }

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      <Box gap={1}>
        <Text color={colors.primary}>• {message.fromCommand}</Text>
        <Spacer />
        <Text color={colors.dimText}>{message.timestamp ? formatTime(message.timestamp) : ''}</Text>
      </Box>

      <Box gap={1}>
        <Box
          borderBottom={false}
          borderColor={isSelected ? colors.primary : undefined}
          borderLeft={isSelected}
          borderRight={false}
          borderStyle="bold"
          borderTop={false}
          height="100%"
          width={1}
        />
        <Box borderTop={false} flexDirection="column" flexGrow={1}>
          {!hasCompletedOutput && showLiveOutput && (
            <LiveStreamingOutput
              activePrompt={activePrompt}
              isStreaming={isStreaming}
              streamingMessages={streamingMessages}
              terminalWidth={terminalWidth}
            />
          )}

          {hasCompletedOutput && <CommandOutput output={message.output!} terminalWidth={terminalWidth} />}

          {/* Expand indicator */}
          {isSelected ? <Text color={colors.dimText}>Show remaining output • [ctrl+o] to expand</Text> : <Text> </Text>}
        </Box>
      </Box>
    </Box>
  )
}
