/**
 * StatusView Component
 *
 * Fetches CLI status and displays it, then calls onComplete.
 */

import {Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {useGetStatus} from '../api/get-status.js'
import {formatStatus} from '../utils/format-status.js'

interface StatusViewProps extends CustomDialogCallbacks {
  version?: string
}

export function StatusView({onComplete, version}: StatusViewProps): React.ReactNode {
  const {data, error, isLoading} = useGetStatus()

  useEffect(() => {
    if (data) {
      onComplete(formatStatus(data.status, version))
    }

    if (error) {
      onComplete(`Failed to get status: ${error.message}`)
    }
  }, [data, error, onComplete, version])

  if (isLoading) {
    return (
      <Text>
        <Spinner type="dots" /> Loading status...
      </Text>
    )
  }

  return null
}
