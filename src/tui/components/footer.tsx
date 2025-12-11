/**
 * Footer Component - Dynamic based on active tab
 */

import { Box, Text } from 'ink'
import React from 'react'

import { useMode } from '../contexts/use-mode.js'
import { useTheme } from '../contexts/use-theme.js'

export const Footer: React.FC = () => {
  const { shortcuts } = useMode()
  const { theme: { colors } } = useTheme()

  return (
    <Box gap={1} paddingX={1} width="100%">
      {shortcuts.map((shortcut, index) => (
        <Box key={shortcut.key}>
          {index > 0 && <Text color={colors.dimText}> •  </Text>}
          <Text color={colors.text}>{shortcut.key}</Text>
          <Text color={colors.dimText}> {shortcut.description}</Text>
        </Box>
      ))}
    </Box>
  )
}
