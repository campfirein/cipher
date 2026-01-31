/**
 * Header Component
 *
 * Sticky header with:
 * - Adaptive ASCII/Text Logo (based on terminal size)
 * - Connected agent status
 * - Queue stats (pending/processing)
 */

import {Box} from 'ink'
import React from 'react'

import {useServices} from '../contexts/index.js'
import {Logo} from './logo.js'

interface HeaderProps {
  compact?: boolean
}

export const Header: React.FC<HeaderProps> = ({compact}) => {
  const {version} = useServices()

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      {/* Logo */}
      <Logo compact={compact} version={version} />
    </Box>
  )
}
