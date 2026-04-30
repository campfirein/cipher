/**
 * Header Component
 *
 * Sticky header with:
 * - Adaptive ASCII/Text Logo (based on terminal size)
 * - Connected agent status
 * - Queue stats (pending/processing)
 */

import {versionsAreEquivalent} from '@campfirein/brv-transport-client'
import {Box, Text} from 'ink'
import React from 'react'

import {useTheme} from '../hooks/index.js'
import {useTransportStore} from '../stores/transport-store.js'
import {Logo} from './logo.js'

interface HeaderProps {
  compact?: boolean
}

export const Header: React.FC<HeaderProps> = ({compact}) => {
  const version = useTransportStore((s) => s.version)
  const daemonVersion = useTransportStore((s) => s.daemonVersion)
  const {
    theme: {colors},
  } = useTheme()

  // Drift indicator: surfaces when this brv build connects to a daemon spawned
  // by a different build. Hidden when versions match or when the daemon is too
  // old to advertise its version (graceful degradation).
  const isOutdated = Boolean(daemonVersion) && !versionsAreEquivalent(version, daemonVersion)

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      {/* Logo */}
      <Logo compact={compact} version={version} />
      {isOutdated && (
        <Box paddingLeft={2}>
          <Text color={colors.warning}>[outdated, daemon v{daemonVersion}]</Text>
        </Box>
      )}
    </Box>
  )
}
