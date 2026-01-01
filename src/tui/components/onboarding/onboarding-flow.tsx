/**
 * Onboarding Flow Component
 *
 * Main container for the onboarding flow.
 * Handles step transitions and init command execution.
 */

import { Box, Text, useInput } from 'ink'
import React, { useMemo } from 'react'

import { useActivityLogs, useMode, useTheme, useUIHeights } from '../../hooks/index.js'
import { useOnboarding } from '../../hooks/use-onboarding.js'
import { calculateLogContentLimit } from '../../utils/log.js'
import { LogItem } from '../execution/index.js'
import { EnterPrompt } from '../index.js'
import { Init } from '../init.js'
import { CopyablePrompt } from './copyable-prompt.js'
import { OnboardingStep } from './onboarding-step.js'

/** Example prompts for curate and query steps */
const CURATE_PROMPT = 'run `brv curate "Auth uses JWT with 24h expiry. Tokens stored in httpOnly cookies"`'
const QUERY_PROMPT = 'run `brv query "How is authentication implemented?"`'

/** Minimum output lines to show before truncation */
const MIN_OUTPUT_LINES = 3

/** Get step number for display */
function getStepNumber(step: string): number {
  switch (step) {
    case 'curate': {
      return 2
    }

    case 'init': {
      return 1
    }

    case 'query': {
      return 3
    }

    default: {
      return 3
    }
  }
}

interface OnboardingFlowProps {
  /** Available height for the onboarding flow */
  availableHeight: number

  /** Optional callback when init completes successfully */
  onInitComplete?: () => void
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ availableHeight, onInitComplete }) => {
  const { theme: { colors } } = useTheme()
  const { mode } = useMode()
  const {
    completeOnboarding,
    curateAcknowledged,
    currentStep,
    hasCurated,
    hasQueried,
    queryAcknowledged,
    setCurateAcknowledged,
    setQueryAcknowledged,
    totalSteps,
  } = useOnboarding()
  const { logs } = useActivityLogs()
  const { messageItem } = useUIHeights()

  // Find running or queued curate/query logs
  const curateLog = useMemo(() => logs.find((log) => log.type === 'curate'), [logs])
  const queryLog = useMemo(() => logs.find((log) => log.type === 'query'), [logs])

  // Onboarding UI overhead: step title (1) + description (1) + content margin top (1)
  const onboardingOverhead = 3
  const enterPromptHeight =
    ((currentStep === 'curate' && hasCurated && !curateAcknowledged) ||
      (currentStep === 'query' && hasQueried && !queryAcknowledged))
      ? 4
      : 0

  const activeLog = currentStep === 'curate' ? curateLog : currentStep === 'query' ? queryLog : null

  let maxOutputLines = MIN_OUTPUT_LINES
  if (activeLog) {
    // Calculate available height for the log (subtract onboarding UI and EnterPrompt)
    const logAvailableHeight = availableHeight - onboardingOverhead - enterPromptHeight
    const parts = calculateLogContentLimit(activeLog, logAvailableHeight, messageItem)
    const contentPart = parts.find((p) => p.field === 'content')
    maxOutputLines = Math.max(MIN_OUTPUT_LINES, contentPart?.lines ?? MIN_OUTPUT_LINES)
  }

  // Determine if we're in a skippable waiting state (curate/query without active log)
  const isInWaitingState =
    mode === 'activity' && ((currentStep === 'curate' && !curateLog) || (currentStep === 'query' && !queryLog))

  // Handle escape key to skip onboarding
  useInput(
    (_input, key) => {
      if (key.escape) {
        completeOnboarding(true) // Pass true to indicate skipped
      }
    },
    { isActive: isInWaitingState },
  )

  // Render curate step content
  const renderCurateContent = () => {
    // Show execution progress if curate is running
    if (curateLog) {
      return (
        <Box flexDirection="column" width="100%">
          <LogItem heights={{ ...messageItem, maxContentLines: maxOutputLines }} log={curateLog} />
          {/* Waiting for Enter to continue */}
          {hasCurated && !curateAcknowledged && (
            <EnterPrompt
              action="continue"
              active={mode === 'activity' && currentStep === 'curate'}
              onEnter={() => setCurateAcknowledged(true)}
            />
          )}
        </Box>
      )
    }

    // Show copyable prompt when waiting
    return (
      <Box backgroundColor={colors.bg2} flexDirection="column" padding={1} width="100%">
        <Text color={colors.text} wrap="wrap">
          Try saying this to your AI Agent:
        </Text>
        <Box marginBottom={1} paddingLeft={4}>
          <Text color={colors.primary} wrap="wrap">{CURATE_PROMPT}</Text>
        </Box>
        <Text>
          <CopyablePrompt
            buttonLabel='[ctrl+y] to copy'
            isActive={mode === 'activity' && currentStep === 'curate'}
            textToCopy={CURATE_PROMPT}
          />
          <Text color={colors.dimText}> | [Esc] to skip onboarding</Text>
        </Text>
        <Box marginTop={1}>
          <Text color={colors.dimText}>
            Waiting for curate...
          </Text>
        </Box>
      </Box>
    )
  }

  // Render query step content
  const renderQueryContent = () => {
    // Show execution progress if query is running
    if (queryLog) {
      return (
        <Box flexDirection="column" width="100%">
          <LogItem heights={{ ...messageItem, maxContentLines: maxOutputLines }} log={queryLog} />
          {/* Waiting for Enter to continue */}
          {hasQueried && !queryAcknowledged && (
            <EnterPrompt
              action="continue"
              active={mode === 'activity' && currentStep === 'query'}
              onEnter={() => setQueryAcknowledged(true)}
            />
          )}
        </Box>
      )
    }

    // Show copyable prompt when waiting
    return (
      <Box backgroundColor={colors.bg2} flexDirection="column" padding={1} width="100%">
        <Text color={colors.text} wrap="wrap">
          You can now query your memory:
        </Text>
        <Box marginBottom={1} paddingLeft={4}>
          <Text color={colors.primary} wrap="wrap">{QUERY_PROMPT}</Text>
        </Box>
        <Text>
          <CopyablePrompt
            buttonLabel='[ctrl+y] to copy'
            isActive={mode === 'activity' && currentStep === 'query'}
            textToCopy={QUERY_PROMPT}
          />
          <Text color={colors.dimText}> | [Esc] to skip onboarding</Text>
        </Text>
        <Box marginTop={1}>
          <Text color={colors.dimText}>
            Waiting for query...
          </Text>
        </Box>
      </Box>
    )
  }

  // Render complete step content
  const renderCompleteContent = () => (
    <Box flexDirection="column">
      <Text color={colors.dimText} wrap="wrap">
        Activity logs will appear here as you use brv curate and brv query.
      </Text>
      <Box flexDirection="column" marginY={1}>
        <Text color={colors.dimText}>Tips:</Text>
        <Text color={colors.dimText}>- Press [Tab] to switch to commands view</Text>
        <Text color={colors.dimText}>- Use /push to sync your context to the cloud</Text>
        <Text color={colors.dimText}>- Use /gen-rules to generate agent rules</Text>
        <Text color={colors.dimText}>- Type / for available commands</Text>
      </Box>
      <EnterPrompt
        action="finish onboarding"
        active={mode === 'activity' && currentStep === 'complete'}
        onEnter={completeOnboarding}
      />
    </Box>
  )

  return (
    <Box
      borderColor={colors.border}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      borderTop={false}
      flexDirection="column"
      height={availableHeight}
      width="100%"
    >
      <Box flexDirection="column" paddingX={1}>
        {currentStep === 'init' && (
          <OnboardingStep
            description="Let's get your project set up with ByteRover."
            stepNumber={getStepNumber('init')}
            title="Welcome to ByteRover!"
            totalSteps={totalSteps}
          >
            <Init
              active={mode === 'activity' && currentStep === 'init'}
              maxOutputLines={MIN_OUTPUT_LINES}
              onInitComplete={onInitComplete}
              showIdleMessage={false}
            />
          </OnboardingStep>
        )}

        {currentStep === 'curate' && (
          <OnboardingStep
            description="Great! Now let's add some context to your knowledge base."
            stepNumber={getStepNumber('curate')}
            title="Add Your First Context"
            totalSteps={totalSteps}
          >
            {renderCurateContent()}
          </OnboardingStep>
        )}

        {currentStep === 'query' && (
          <OnboardingStep
            description="Excellent! Your context is saved. Let's query it."
            stepNumber={getStepNumber('query')}
            title="Query Your Knowledge"
            totalSteps={totalSteps}
          >
            {renderQueryContent()}
          </OnboardingStep>
        )}

        {currentStep === 'complete' && (
          <OnboardingStep
            description="Your ByteRover workspace is ready!"
            showStepIndicator={false}
            stepNumber={totalSteps}
            title="You're All Set!"
            totalSteps={totalSteps}
          >
            {renderCompleteContent()}
          </OnboardingStep>
        )}
      </Box>
    </Box>
  )
}
