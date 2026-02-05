/**
 * Onboarding Item Component
 *
 * Displays a single onboarding log entry during the onboarding flow.
 */

import {Box, Spacer, Text} from 'ink'
import React, {useEffect, useState} from 'react'

import type {ActivityLog} from '../types.js'

import {useTheme} from '../hooks/index.js'
import {formatTime} from '../utils/index.js'
import {ExecutionChanges, ExecutionContent, ExecutionInput} from './index.js'

/**
 * Animated processing indicator that cycles through dots: "Processing." -> "Processing.." -> "Processing..."
 */
const ProcessingIndicator: React.FC<{color: string}> = ({color}) => {
  const [dotCount, setDotCount] = useState(1)

  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev) => (prev >= 3 ? 1 : prev + 1))
    }, 800)

    return () => clearInterval(interval)
  }, [])

  const dots = '.'.repeat(dotCount)

  return (
    <Text color={color} italic>
      Processing{dots}
    </Text>
  )
}

interface OnboardingItemProps {
  /** Whether this item is currently selected */
  isSelected?: boolean
  /** The onboarding log to display */
  log: Pick<ActivityLog, 'changes' | 'content' | 'id' | 'input' | 'status' | 'timestamp' | 'type'>
  /** Whether to show the expand/collapse indicator */
  shouldShowExpand?: boolean
}

export const OnboardingItem: React.FC<OnboardingItemProps> = ({isSelected, log, shouldShowExpand}) => {
  const {
    theme: {colors},
  } = useTheme()

  const displayTime = formatTime(log.timestamp)

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      {/* Header */}
      <Box gap={1}>
        <Text color={colors.primary}>• {log.type}</Text>
        <Spacer />
        <Text color={colors.dimText}>{displayTime}</Text>
      </Box>
      <Box gap={1}>
        <Box
          borderBottom={false}
          borderColor={isSelected ? colors.primary : undefined}
          borderLeft={isSelected}
          borderRight={false}
          borderStyle="bold"
          borderTop={false}
          height="100%"
          width={1}
        />
        <Box borderTop={false} flexDirection="column" flexGrow={1}>
          {/* Input */}
          <ExecutionInput input={log.input} />

          {/* Processing indicator - Show while running */}
          {log.status === 'running' && <ProcessingIndicator color={colors.dimText} />}

          {/* Final Content - Show after completion or error */}
          {(log.status === 'failed' || log.status === 'completed') && (
            <ExecutionContent
              bottomMargin={0}
              content={log.content ?? ''}
              isError={log.status === 'failed'}
              maxLines={3}
            />
          )}

          {/* Changes */}
          {log.status === 'completed' && (
            <ExecutionChanges
              created={log.changes.created}
              isExpanded={false}
              marginTop={1}
              maxChanges={{created: 3, updated: 3}}
              updated={log.changes.updated}
            />
          )}

          {/* Expand indicator */}
          {shouldShowExpand && (
            isSelected ? (
              <Text color={colors.dimText}>Show remaining output • [ctrl+o] to expand</Text>
            ) : (
              <Text> </Text>
            )
          )}
        </Box>
      </Box>
    </Box>
  )
}
