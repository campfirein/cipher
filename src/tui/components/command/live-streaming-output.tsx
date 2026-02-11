/**
 * Live Streaming Output Component
 *
 * Renders live streaming output while a command is running.
 */

import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React from 'react'

import type {StreamingMessage} from '../../types/index.js'

import {useTheme} from '../../hooks/index.js'
import {
  getMessagesFromEnd,
  MAX_OUTPUT_LINES,
  processMessagesForActions,
  StreamingMessageItem,
} from './command-output.js'

export interface LiveStreamingOutputProps {
  isExpanded?: boolean
  isStreaming: boolean
  streamingMessages: StreamingMessage[]
  terminalWidth: number
}

/**
 * Renders live streaming output (while running)
 */
export const LiveStreamingOutput: React.FC<LiveStreamingOutputProps> = ({
  isExpanded,
  isStreaming,
  streamingMessages,
  terminalWidth,
}) => {
  const {
    theme: {colors},
  } = useTheme()
  const processedMessages = processMessagesForActions(streamingMessages)
  const outputLimit = isExpanded ? Number.MAX_SAFE_INTEGER : MAX_OUTPUT_LINES
  const {displayMessages, skippedLines} = getMessagesFromEnd(processedMessages, outputLimit, terminalWidth)

  return (
    <Box
      borderColor={isExpanded ? undefined : colors.border}
      borderStyle={isExpanded ? undefined : 'single'}
      flexDirection="column"
      paddingX={1}
      paddingY={0}
      width="100%"
    >
      {skippedLines > 0 && !isExpanded && (
        <Text color={colors.dimText} dimColor>
          ↑ {skippedLines} more lines above
        </Text>
      )}

      {displayMessages.map((streamMsg) => (
        <StreamingMessageItem key={streamMsg.id} message={streamMsg} />
      ))}

      {isStreaming && displayMessages.length === 0 && (
        <Text color={colors.dimText}>
          <Spinner type="dots" /> Processing...
        </Text>
      )}
    </Box>
  )
}
