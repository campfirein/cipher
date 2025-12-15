/**
 * Onboarding Step Component
 *
 * Displays an individual onboarding step with title, description, and content.
 */

import {Box, Text} from 'ink'
import React from 'react'

import {useTheme} from '../../hooks/index.js'

export type OnboardingStepType = 'complete' | 'curate' | 'init' | 'query'

interface OnboardingStepProps {
  /** Child content to render */
  children?: React.ReactNode
  /** Step description */
  description: string
  /** Whether to show step indicator (default: true) */
  showStepIndicator?: boolean
  /** Current step number (1-indexed) */
  stepNumber: number
  /** Step title */
  title: string
  /** Total number of steps */
  totalSteps: number
}

export const OnboardingStep: React.FC<OnboardingStepProps> = ({
  children,
  description,
  showStepIndicator = true,
  stepNumber,
  title,
  totalSteps,
}) => {
  const {
    theme: {colors},
  } = useTheme()

  return (
    <Box flexDirection="column" paddingX={2}>
      {/* Title */}
      <Text bold color={colors.primary}>
        {title}{' '}
        {showStepIndicator && (
          <Text color={colors.dimText}>
            ({stepNumber}/{totalSteps})
          </Text>
        )}
      </Text>

      {/* Description */}
      <Text>{description}</Text>

      {/* Content */}
      {children && <Box marginTop={1}>{children}</Box>}
    </Box>
  )
}
