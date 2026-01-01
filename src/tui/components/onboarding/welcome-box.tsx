/**
 * Welcome Box Component
 *
 * Displays welcome message and getting started instructions for new users
 */

import {Box, Spacer, Text} from 'ink'
import React from 'react'

import {useTheme} from '../../hooks/index.js'
import {formatTime} from '../../utils/time.js'
import {CopyablePrompt} from './copyable-prompt.js'

interface WelcomeBoxProps {
  /**
   * Whether the copy prompt is active (responds to keyboard shortcuts)
   */
  isCopyActive: boolean
}

export const WelcomeBox: React.FC<WelcomeBoxProps> = ({isCopyActive}) => {
  const {
    theme: {colors},
  } = useTheme()

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      {/* Header */}
      <Box>
        <Text color={colors.dimText}>@agent</Text>
        <Spacer />
        <Text color={colors.dimText}>[{formatTime(new Date())}]</Text>
      </Box>
      <Box borderColor={colors.border} borderStyle="single" flexDirection="column" gap={1} paddingX={1}>
        <Text bold color={colors.primary}>
          Welcome to ByteRover!
        </Text>
        <Box flexDirection="column" paddingLeft={2}>
          <Text color={colors.text}>
            Tell your AI Agent what to save or retrieve. Just start your prompt with "
            <Text color={colors.primary}>brv</Text>".
          </Text>
          <Box marginTop={1}>
            <Text color={colors.text}>Try saying this to your AI Agent:</Text>
          </Box>
          <Box flexDirection="column" paddingLeft={4}>
            <Text color={colors.text}>
              brv curate "Add this as my first memory."{'    '}
              <CopyablePrompt
                buttonLabel="[ctrl+y] to copy"
                isActive={isCopyActive}
                textToCopy={`brv curate "Add this as my first memory."`}
              />
            </Text>
          </Box>

          <Box marginTop={1}>
            <Text color={colors.text} dimColor>
              Press [Tab] to switch to Console mode
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
