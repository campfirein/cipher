/**
 * Header Component
 *
 * Sticky header with:
 * - Adaptive ASCII/Text Logo (based on terminal size)
 * - Connected agent status
 * - Queue stats (pending/processing)
 */

import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React from 'react'

import type {QueueStats} from '../types.js'

import {useServices} from '../contexts/index.js'
import {Logo} from './logo.js'

interface HeaderProps {
  compact?: boolean
  connectedAgent?: string
  queueStats?: QueueStats
}

export const Header: React.FC<HeaderProps> = ({compact, connectedAgent, queueStats}) => {
  const {version} = useServices()

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
        </Box>

        {/* Queue Stats */}
        {queueStats && (
          <Box>
            <Text color="yellow">{queueStats.pending}</Text>
            <Text color="gray"> pending</Text>
            {queueStats.processing > 0 && (
              <>
                <Text color="cyan">
                  <Spinner type="dots" /> {queueStats.processing}
                </Text>
                <Text color="gray"> processing</Text>
              </>
            )}
          </Box>
        )}
      </Box>
    </Box>
  )
}
