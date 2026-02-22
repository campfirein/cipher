import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React from 'react'

import {useTheme} from '../../../hooks/index.js'
import {useRemoveHubRegistry} from '../api/remove-hub-registry.js'

interface HubRegistryRemoveViewProps {
  name: string
  onCancel: () => void
  onComplete: (message: string) => void
}

export function HubRegistryRemoveView({name, onComplete}: HubRegistryRemoveViewProps): React.ReactNode {
  const {
    theme: {colors},
  } = useTheme()
  const removeMutation = useRemoveHubRegistry()

  React.useEffect(() => {
    removeMutation
      .mutateAsync({name})
      .then((result) => onComplete(result.message))
      .catch((error: unknown) =>
        onComplete(`Failed to remove registry: ${error instanceof Error ? error.message : 'Unknown error'}`),
      )
  }, [])

  return (
    <Box gap={1}>
      <Text color={colors.primary}>
        <Spinner type="dots" />
      </Text>
      <Text color={colors.text}>
        Removing registry <Text bold>{name}</Text>...
      </Text>
    </Box>
  )
}
