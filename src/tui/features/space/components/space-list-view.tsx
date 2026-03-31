/**
 * SpaceListView Component
 *
 * Fetches and displays all spaces for the current team.
 */

import {Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect, useMemo} from 'react'

import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {formatTransportError} from '../../../utils/error-messages.js'
import {useGetSpaces} from '../api/get-spaces.js'

interface SpaceListViewProps extends CustomDialogCallbacks {
  json?: boolean
}

export function SpaceListView({json, onComplete}: SpaceListViewProps): React.ReactNode {
  const {data, error, isLoading} = useGetSpaces()

  const result = useMemo(() => {
    if (!data) return null

    const {teams} = data

    if (teams.length === 0) return 'No teams found.'

    if (json) {
      return JSON.stringify(
        teams.map((t) => ({
          teamId: t.teamId,
          teamName: t.teamName,
          // eslint-disable-next-line perfectionist/sort-objects
          spaces: t.spaces.map((s) => ({
            isDefault: s.isDefault,
            spaceId: s.id,
            spaceName: s.name,
          })),
        })),
        undefined,
        2,
      )
    }

    const lines: string[] = []
    for (const [index, team] of teams.entries()) {
      lines.push(`${index + 1}. ${team.teamName} (team)`)
      if (team.spaces.length === 0) {
        lines.push('   No spaces')
      } else {
        for (const space of team.spaces) {
          const defaultMarker = space.isDefault ? ' (default)' : ''
          lines.push(`   - ${space.name}${defaultMarker} (space)`)
        }
      }
    }

    return lines.join('\n')
  }, [data, json])

  useEffect(() => {
    if (result) onComplete(result)
    if (error) onComplete(`Failed to list spaces: ${formatTransportError(error)}`)
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
