/**
 * Header Component
 *
 * Sticky header with:
 * - Adaptive ASCII/Text Logo (based on terminal size)
 * - Connected agent status
 * - Queue stats (pending/processing)
 */

import {Box, Text} from 'ink'
import React, {useEffect, useState} from 'react'

import {useServices, useStatus} from '../contexts/index.js'
import {useTheme} from '../contexts/theme-context.js'
import {useTerminalBreakpoint} from '../hooks/use-terminal-breakpoint.js'
import {TaskStats} from '../types/ui.js'
import {Logo} from './logo.js'
import {StatusBadge, StatusType} from './status-badge.js'

interface HeaderProps {
  compact?: boolean
  connectedAgent?: string
  showTransportStats?: boolean
  taskStats?: TaskStats
}

interface StatusProps {
  message: string
  type: StatusType
}

export const Header: React.FC<HeaderProps> = ({compact, showTransportStats, taskStats: transportStats}) => {
  const {version} = useServices()
  const {theme} = useTheme()
  const {breakpoint} = useTerminalBreakpoint()
  const {currentEvent} = useStatus()
  const [breakpointWarning, setBreakpointWarning] = useState<null | StatusProps>(null)

  useEffect(() => {
    if (breakpoint === 'compact') {
      setBreakpointWarning({
        message: 'Terminal too small - expand for better experience',
        type: 'warning',
      })
    } else {
      setBreakpointWarning(null)
    }
  }, [breakpoint])

  // Status event takes priority over breakpoint warning
  const displayStatus = currentEvent
    ? {label: currentEvent.label, message: currentEvent.message, type: currentEvent.type}
    : breakpointWarning
      ? {label: breakpointWarning.type, message: breakpointWarning.message, type: breakpointWarning.type}
      : null

  return (
    <Box flexDirection="column" width="100%">
      {/* Logo */}
      <Logo compact={compact} version={version} />

      {/* Status line */}
      <Box gap={2} justifyContent="space-between">
        {/* Status state */}
        <StatusBadge
          label={displayStatus?.label ?? 'Idle'}
          message={displayStatus?.message ?? 'Ready'}
          type={displayStatus?.type ?? 'info'}
        />

        {/* Transport Stats */}
        {showTransportStats && (
          <Box flexShrink={0} paddingRight={1}>
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
