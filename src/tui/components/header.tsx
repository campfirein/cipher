/**
 * Header Component
 *
 * Sticky header with:
 * - Adaptive ASCII/Text Logo (based on terminal size)
 * - Connected agent status
 * - Queue stats (pending/processing)
 */

import {versionsAreEquivalent} from '@campfirein/brv-transport-client'
import {Box} from 'ink'
import React from 'react'

import {useTransportStore} from '../stores/transport-store.js'
import {Logo} from './logo.js'

interface HeaderProps {
  compact?: boolean
}

export const Header: React.FC<HeaderProps> = ({compact}) => {
  const version = useTransportStore((s) => s.version)
  const daemonVersion = useTransportStore((s) => s.daemonVersion)

  // Drift indicator surfaces when this brv build connects to a daemon spawned
  // by a different build. Rendered inline by Logo so the banner stays a single
  // line; hidden when versions match or the daemon is too old to advertise.
  const isOutdated = daemonVersion !== undefined && !versionsAreEquivalent(version, daemonVersion)

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      <Logo compact={compact} driftDaemonVersion={isOutdated ? daemonVersion : undefined} version={version} />
    </Box>
  )
}
