/**
 * SpaceListView Component
 *
 * Fetches and displays all spaces for the current team.
 */

import {Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect, useMemo} from 'react'

import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {useGetSpaces} from '../api/get-spaces.js'

interface SpaceListViewProps extends CustomDialogCallbacks {
  json?: boolean
}

export function SpaceListView({json, onComplete}: SpaceListViewProps): React.ReactNode {
  const {data, error, isLoading} = useGetSpaces()

  const result = useMemo(() => {
    if (!data) return null

    const {spaces} = data

    if (spaces.length === 0) return 'No spaces found.'

    if (json) return JSON.stringify(spaces, undefined, 2)

    const lines = [`\nFound ${spaces.length} space(s):\n`]
    for (const [index, space] of spaces.entries()) {
      const defaultMarker = space.isDefault ? ' (default)' : ''
      lines.push(`  ${index + 1}. ${space.name}${defaultMarker}`)
    }

    return lines.join('\n')
  }, [data, json])

  useEffect(() => {
    if (result) onComplete(result)
    if (error) onComplete(`Failed to list spaces: ${error.message}`)
  }, [error, onComplete, result])

  if (isLoading) {
    return (
      <Text>
        <Spinner type="dots" /> Fetching spaces...
      </Text>
    )
  }

  return null
}
