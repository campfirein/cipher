/**
 * Execution Status Component
 *
 * Displays the execution status with appropriate spinner and message.
 */

import {Text} from 'ink'
import Spinner from 'ink-spinner'
import React from 'react'

import type {ExecutionStatus as ExecutionStatusType} from '../../../core/domain/cipher/queue/types.js'

import {useTheme} from '../../hooks/index.js'

interface ExecutionStatusProps {
  /** The execution status */
  status: ExecutionStatusType
}

export const ExecutionStatus: React.FC<ExecutionStatusProps> = ({status}) => {
  const {
    theme: {colors},
  } = useTheme()

  if (status === 'running') {
    return (
      <Text color={colors.dimText}>
        <Spinner type="line" /> Processing...
      </Text>
    )
  }

  if (status === 'queued') {
    return (
      <Text color={colors.dimText}>
        <Spinner type="dots" /> Queued...
      </Text>
    )
  }

  return null
}
