/**
 * Header Component
 *
 * Sticky header with:
 * - Adaptive ASCII/Text Logo (based on terminal size)
 * - Connected agent status
 * - Queue stats (pending/processing)
 */

import {Box, Spacer, Text} from 'ink'
import React from 'react'

import {useServices} from '../contexts/index.js'
import {useTheme} from '../contexts/theme-context.js'
import {useTerminalBreakpoint} from '../hooks/use-terminal-breakpoint.js'
import {TaskStats} from '../types/ui.js'
import {Logo} from './logo.js'

interface HeaderProps {
  compact?: boolean
  connectedAgent?: string
  showTransportStats?: boolean
  taskStats?: TaskStats
}

export const Header: React.FC<HeaderProps> = ({compact, connectedAgent, showTransportStats, taskStats: transportStats}) => {
  const {version} = useServices()
  const {theme} = useTheme()
  const {breakpoint} = useTerminalBreakpoint()

  return (
    <Box flexDirection="column" width="100%">
      {/* Logo */}
      <Logo compact={compact} version={version} />

      {/* Status line */}
      <Box justifyContent="space-between">
        <Box gap={2}>
          {/* Connected Agent */}
          {connectedAgent && (
            <Box>
              <Text color="green">● </Text>
              <Text color="gray">{connectedAgent}</Text>
            </Box>
          )}
          {breakpoint === "compact" && (
            <Text color={theme.colors.warning}>Terminal too small - expand for better experience</Text>
          )}
        </Box>

        {/* Transport Stats */}

        {showTransportStats && (
          <Box paddingRight={1}>
            <Spacer />
            <Text>~ in queue: </Text>
            <Text color={theme.colors.warning}>{transportStats?.created ?? 0}</Text>
            <Text> | running: </Text>
            <Text color={theme.colors.primary}>{transportStats?.started ?? 0}</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
