/**
 * MessageItem Component
 *
 * Displays a single command message with the command name and result
 */

import { Box, Text } from 'ink'
import React from 'react'

import type { CommandMessage } from '../types.js'

import { useTheme } from '../hooks/index.js'

interface MessageItemProps {
  message: CommandMessage
}

export const MessageItem: React.FC<MessageItemProps> = ({ message }) => {
  const { theme: { colors } } = useTheme()

  return (
    <Box alignItems="flex-start" flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" gap={1}>
        <Box borderBottom={false} borderLeftColor={colors.primary} borderRight={false} borderStyle="bold" borderTop={false} />
        <Text>
          {message.fromCommand}
        </Text>
      </Box>
      <Box borderColor={colors.border} borderStyle="single" width="100%">
        <Text>{message.content}</Text>
      </Box>
    </Box>
  )
}
