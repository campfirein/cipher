/**
 * Execution Changes Component
 *
 * Displays created and updated file paths from an execution.
 */

import {Box, Text} from 'ink'
import React from 'react'

import {useTheme} from '../../hooks/index.js'

interface ExecutionChangesProps {
  /** List of created file paths */
  created: string[]
  /** List of updated file paths */
  updated: string[]
}

export const ExecutionChanges: React.FC<ExecutionChangesProps> = ({created, updated}) => {
  const {
    theme: {colors},
  } = useTheme()

  if (created.length === 0 && updated.length === 0) {
    return null
  }

  return (
    <>
      {created.length > 0 && (
        <Box columnGap={1}>
          <Text color={colors.secondary}>created at:</Text>
          <Box flexDirection="column">
            {created.map((path) => (
              <Text key={path}>{path}</Text>
            ))}
          </Box>
        </Box>
      )}
      {updated.length > 0 && (
        <Box columnGap={1}>
          <Text color={colors.secondary}>updated at:</Text>
          <Box flexDirection="column">
            {updated.map((path) => (
              <Text key={path}>{path}</Text>
            ))}
          </Box>
        </Box>
      )}
    </>
  )
}
