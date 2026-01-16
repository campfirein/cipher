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
  /** Whether content should be fully expanded (no truncation) */
  isExpand?: boolean
  /** Maximum changes configuration */
  maxChanges?: {
    created: number // Max lines for created section (including header and indicator)
    updated: number // Max lines for updated section (including header and indicator)
  }
  /** List of updated file paths */
  updated: string[]
}

export const ExecutionChanges: React.FC<ExecutionChangesProps> = ({
  created,
  isExpand = false,
  updated,
  maxChanges = {created: Number.MAX_SAFE_INTEGER, updated: Number.MAX_SAFE_INTEGER},
}) => {
  const {
    theme: {colors},
  } = useTheme()

  const totalChanges = created.length + updated.length

  if (totalChanges === 0) {
    return null
  }

  const hasCreated = created.length > 0
  const hasUpdated = updated.length > 0

  // In expand mode, show all changes without truncation
  if (isExpand) {
    return (
      <Box flexDirection="column">
        {hasCreated && (
          <Box columnGap={1}>
            <Text color={colors.secondary}>created at:</Text>
            <Box flexDirection="column">
              {created.map((path) => (
                <Text key={path}>{path}</Text>
              ))}
            </Box>
          </Box>
        )}
        {hasUpdated && (
          <Box columnGap={1}>
            <Text color={colors.secondary}>updated at:</Text>
            <Box flexDirection="column">
              {updated.map((path) => (
                <Text key={path}>{path}</Text>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    )
  }

  // Calculate overflow for each section
  // maxChanges represents total lines (items + indicator if overflow)
  const createdOverflow = created.length > maxChanges.created
  const updatedOverflow = updated.length > maxChanges.updated

  // Calculate visible items per section
  // If overflow, reserve 1 line for indicator, show (maxChanges - 1) items
  const createdItemsMax = createdOverflow ? maxChanges.created - 1 : maxChanges.created
  const updatedItemsMax = updatedOverflow ? maxChanges.updated - 1 : maxChanges.updated

  const visibleCreated = created.slice(0, Math.max(0, createdItemsMax))
  const visibleUpdated = updated.slice(0, Math.max(0, updatedItemsMax))

  const createdRemaining = created.length - visibleCreated.length
  const updatedRemaining = updated.length - visibleUpdated.length

  return (
    <Box flexDirection="column">
      {hasCreated && (
        <Box columnGap={1}>
          <Text color={colors.secondary}>created at:</Text>
          <Box flexDirection="column">
            {visibleCreated.map((path) => (
              <Text key={path}>{path}</Text>
            ))}
            {createdRemaining > 0 && <Text color={colors.dimText}>... and {createdRemaining} more created</Text>}
          </Box>
        </Box>
      )}
      {hasUpdated && (
        <Box columnGap={1}>
          <Text color={colors.secondary}>updated at:</Text>
          <Box flexDirection="column">
            {visibleUpdated.map((path) => (
              <Text key={path}>{path}</Text>
            ))}
            {updatedRemaining > 0 && <Text color={colors.dimText}>... and {updatedRemaining} more updated</Text>}
          </Box>
        </Box>
      )}
    </Box>
  )
}
