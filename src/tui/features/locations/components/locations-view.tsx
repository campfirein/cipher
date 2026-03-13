import {Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect} from 'react'

import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {useGetLocations} from '../api/get-locations.js'
import {formatLocations} from '../utils/format-locations.js'

export function LocationsView({onComplete}: CustomDialogCallbacks): React.ReactNode {
  const {data, error, isLoading} = useGetLocations()

  useEffect(() => {
    if (data) {
      onComplete(formatLocations(data.locations))
    }

    if (error) {
      onComplete(`Failed to get locations: ${error.message}`)
    }
  }, [data, error, onComplete])

  if (isLoading) {
    return (
      <Text>
        <Spinner type="dots" /> Loading locations...
      </Text>
    )
  }

  return null
}
