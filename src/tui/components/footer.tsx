/**
 * Footer Component - Dynamic based on active tab
 */

import {Box, Text} from 'ink'
import React, {useMemo} from 'react'

import {useMode} from '../contexts/mode-context.js'
import {useOnboarding} from '../contexts/onboarding-context.js'
import {useTheme} from '../contexts/theme-context.js'

export const Footer: React.FC = () => {
  const {shortcuts} = useMode()
  const {shouldShowOnboarding} = useOnboarding()
  const {
    theme: {colors},
  } = useTheme()

  // Filter out 'tab' shortcut during onboarding (tab switching is disabled)
  const visibleShortcuts = useMemo(
    () => (shouldShowOnboarding ? shortcuts.filter((s) => s.key !== 'tab') : shortcuts),
    [shortcuts, shouldShowOnboarding],
  )

  return (
    <Box paddingX={1} width="100%">
      {visibleShortcuts.map((shortcut, index) => (
        <Box key={shortcut.key}>
          {index > 0 && <Text color={colors.dimText}> • </Text>}
          <Text color={colors.text}>{shortcut.key}</Text>
          <Text color={colors.dimText}> {shortcut.description}</Text>
        </Box>
      ))}
    </Box>
  )
}
