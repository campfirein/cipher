/**
 * Footer Component - Dynamic based on active tab
 */

import {Box, Spacer, Text} from 'ink'
import React from 'react'

import {useMode, useOnboarding, useTasks, useTheme} from '../contexts/index.js'

export const Footer: React.FC = () => {
  const {shortcuts} = useMode()
  const {isLoadingOnboardingCheck, shouldShowOnboarding} = useOnboarding()
  const {
    theme: {colors},
  } = useTheme()
  const {stats: taskStats} = useTasks()

  if (shouldShowOnboarding || isLoadingOnboardingCheck) {
    return <Box height={1} paddingX={1} width="100%" />
  }

  return (
    <Box paddingX={1} width="100%">
      <Box flexShrink={0}>
        <Text color={colors.dimText}>~ in queue: </Text>
        <Text color={colors.warning}>{taskStats?.created ?? 0}</Text>
        <Text color={colors.dimText}> | running: </Text>
        <Text color={colors.primary}>{taskStats?.started ?? 0}</Text>
      </Box>
      <Spacer />
      {shortcuts.map((shortcut, index) => (
        <Box key={shortcut.key}>
          {index > 0 && <Text color={colors.dimText}> • </Text>}
          <Text color={colors.text}>{shortcut.key}</Text>
          <Text color={colors.dimText}> {shortcut.description}</Text>
        </Box>
      ))}
    </Box>
  )
}
