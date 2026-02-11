/**
 * MessageItem Component
 *
 * Displays a single command message with the command name and result
 */

import {Box, Spacer, Text, useInput} from 'ink'
import React from 'react'

import type {CommandMessage} from '../types/index.js'

import {useTheme} from '../hooks/index.js'
import {formatTime} from '../utils/index.js'

interface MessageItemProps {
  isActive?: boolean
  isExpanded?: boolean
  isSelected?: boolean
  message: CommandMessage
  onClose?: () => void
}

export const MessageItem: React.FC<MessageItemProps> = ({isActive, isExpanded, isSelected, message, onClose}) => {
  const {
    theme: {colors},
  } = useTheme()
  const displayTime = message.timestamp ? formatTime(message.timestamp) : ''

  useInput(
    (input, key) => {
      if ((key.ctrl && input === 'o') || key.escape) {
        onClose?.()
      }
    },
    {isActive: isActive && isExpanded},
  )

  if (isExpanded) {
    return (
      <Box flexDirection="column" height="100%" paddingBottom={1} width="100%">
        {/* Fixed Header */}
        <Box gap={1}>
          <Text color={colors.primary}>• {message.fromCommand}</Text>
          <Spacer />
          <Text color={colors.dimText}>{displayTime}</Text>
        </Box>

        {/* Content area */}
        <Box borderColor={colors.border} borderStyle="single" flexDirection="column" flexGrow={1} paddingX={1}>
          <Text>{message.content}</Text>
        </Box>
        <Box>
          <Text color={colors.dimText}>[ctrl+o] to collapse</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      <Box gap={1}>
        <Text color={colors.primary}>• {message.fromCommand}</Text>
        <Spacer />
        <Text color={colors.dimText}>{displayTime}</Text>
      </Box>
      <Box gap={1} width="100%">
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
        <Box flexDirection="column" flexGrow={1}>
          <Box borderColor={colors.border} borderStyle="single" paddingX={1} width="100%">
            <Text>{message.content}</Text>
          </Box>

          {/* Expand indicator */}
          {isSelected ? <Text color={colors.dimText}>Show remaining output • [ctrl+o] to expand</Text> : <Text> </Text>}
        </Box>
      </Box>
    </Box>
  )
}
