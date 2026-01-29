/**
 * Live Streaming Output Component
 *
 * Renders live streaming output while a command is running,
 * including inline prompts for user interaction.
 */

import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useCallback} from 'react'

import type {PromptRequest, StreamingMessage} from '../../types.js'

import {useCommands} from '../../contexts/commands-context.js'
import {useTerminalBreakpoint, useTheme} from '../../hooks/index.js'
import {
  InlineConfirm,
  InlineFileSelector,
  InlineInput,
  InlineSearch,
  InlineSelect,
} from '../inline-prompts/index.js'
import {
  getMessagesFromEnd,
  MAX_OUTPUT_LINES,
  processMessagesForActions,
  StreamingMessageItem,
} from './command-output.js'

export interface LiveStreamingOutputProps {
  activePrompt: null | PromptRequest
  isExpanded?: boolean
  isStreaming: boolean
  streamingMessages: StreamingMessage[]
  terminalWidth: number
}

/**
 * Renders live streaming output (while running)
 */
export const LiveStreamingOutput: React.FC<LiveStreamingOutputProps> = ({
  activePrompt,
  isExpanded,
  isStreaming,
  streamingMessages,
  terminalWidth,
}) => {
  const {setActivePrompt} = useCommands()
  const {theme: {colors}} = useTheme()
  const {breakpoint} = useTerminalBreakpoint()
  const processedMessages = processMessagesForActions(streamingMessages)
  const outputLimit = isExpanded ? Number.MAX_SAFE_INTEGER : MAX_OUTPUT_LINES
  const {displayMessages, skippedLines} = getMessagesFromEnd(processedMessages, outputLimit, terminalWidth)

  // Calculate page size for file selector
  const fileSelectorPageSize = 3

  const handlePromptResponse = useCallback((value: unknown) => {
    if (activePrompt) {
      activePrompt.onResponse(value as never)
      setActivePrompt(null)
    }
  }, [activePrompt, setActivePrompt])

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

      {isStreaming && !activePrompt && displayMessages.length === 0 && (
        <Text color={colors.dimText}>
          <Spinner type="dots" /> Processing...
        </Text>
      )}

      {activePrompt?.type === 'confirm' && (
        <InlineConfirm
          default={activePrompt.default}
          message={activePrompt.message}
          onConfirm={(value) => handlePromptResponse(value)}
        />
      )}

      {activePrompt?.type === 'file_selector' && (
        <InlineFileSelector
          allowCancel={activePrompt.allowCancel}
          basePath={activePrompt.basePath}
          filter={activePrompt.filter}
          message={activePrompt.message}
          mode={activePrompt.mode}
          onSelect={(value) => handlePromptResponse(value)}
          pageSize={breakpoint === 'normal' ? fileSelectorPageSize : 2}
        />
      )}

      {activePrompt?.type === 'input' && (
        <InlineInput
          message={activePrompt.message}
          onSubmit={(value) => handlePromptResponse(value)}
          placeholder={activePrompt.placeholder}
          validate={activePrompt.validate}
        />
      )}

      {activePrompt?.type === 'search' && (
        <InlineSearch
          message={activePrompt.message}
          onSelect={(value) => handlePromptResponse(value)}
          source={activePrompt.source}
        />
      )}

      {activePrompt?.type === 'select' && (
        <InlineSelect
          choices={activePrompt.choices}
          message={activePrompt.message}
          onSelect={(value) => handlePromptResponse(value)}
        />
      )}

      {isStreaming && activePrompt && (
        <Box marginTop={1}>
          <Text color={colors.dimText}>[esc] to cancel</Text>
        </Box>
      )}
    </Box>
  )
}
