/**
 * Status Badge Component
 *
 * Displays a status indicator with colored badge and optional message
 */

import {Box, Text} from 'ink'
import React, {useMemo} from 'react'

import {useTheme} from '../contexts/theme-context.js'

export type StatusType = 'error' | 'info' | 'success' | 'warning'

export interface StatusBadgeProps {
  /**
   * Label text to display in the badge
   */
  label: string
  /**
   * Optional message to display next to the badge
   */
  message?: string
  /**
   * The status type - determines badge color
   */
  type: StatusType
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({label, message, type}) => {
  const {theme} = useTheme()

  const statusBgColor = useMemo(() => {
    switch (type) {
      case 'error': {
        return theme.colors.errorText
      }

      case 'info': {
        return theme.colors.secondary
      }

      case 'success': {
        return theme.colors.primary
      }

      case 'warning': {
        return theme.colors.warning
      }

      default: {
        return theme.colors.dimText
      }
    }
  }, [type, theme])

  return (
    <Box flexDirection="row" gap={1} height={1}>
      <Box backgroundColor={statusBgColor} flexShrink={0} paddingX={1}>
        <Text color={theme.colors.text}>{label}</Text>
      </Box>
      {message && (
        <Box flexGrow={1} overflow="hidden">
          <Text color={theme.colors.text} wrap="truncate-end">
            {message}
          </Text>
        </Box>
      )}
    </Box>
  )
}
