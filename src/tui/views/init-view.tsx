/**
 * Init View
 *
 * Standalone project initialization view shown when .brv/config.json doesn't exist
 * but user is not in onboarding mode.
 */

import {Box, Text, useInput} from 'ink'
import React, {useState} from 'react'

import {EnterPrompt, Init} from '../components/index.js'
import {useAuth, useTransport} from '../contexts/index.js'
import {useMode, useTheme} from '../hooks/index.js'

type InitStep = 'complete' | 'init' | 'prompt'

/** Minimum output lines to show before truncation */
const MIN_OUTPUT_LINES = 3

interface InitViewProps {
  /** Available height for the init view */
  availableHeight: number

  /** Callback when initialization is complete and user acknowledges */
  onInitComplete?: () => void
}

export const InitView: React.FC<InitViewProps> = ({availableHeight, onInitComplete}) => {
  const {theme: {colors}} = useTheme()
  const {mode} = useMode()
  const [step, setStep] = useState<InitStep>('prompt')
  const {reloadAuth} = useAuth()
  const {client} = useTransport()

  const maxOutputLines = MIN_OUTPUT_LINES

  // Handle keyboard input for prompt step
  useInput(
    (input, key) => {
      if (key.return) {
        setStep('init')
      }

      if (input.toLowerCase() === 's') {
        onInitComplete?.()
      }
    },
    {isActive: mode === 'main' && step === 'prompt'}
  )
  
  const handleInitComplete = async () => {
    onInitComplete?.()
    // Reload auth to detect config change
    await reloadAuth()

    // Restart agent to pick up new project state
    if (client) {
      await client.requestWithAck('agent:restart', {reason: 'Project initialized'})
    }
  }

  return (
    <Box flexDirection="column" height={availableHeight} width="100%">
      <Box flexDirection="column" paddingX={1}>
        {step === 'prompt' && (
          <>
            <Box flexDirection="column" marginY={1}>
              <Text bold color={colors.primary}>Welcome to ByteRover!</Text>
            </Box>
            <Box flexDirection="column" rowGap={1}>
              <Text color={colors.text}>
                This folder isn't connected to ByteRover yet.{'\n'}
                Let's set it up so your AI agents can access shared project knowledge.
              </Text>
              <Box flexDirection="column">
                <Text color={colors.dimText}>[Enter] Set up now</Text>
                <Text color={colors.dimText}>[S]     Skip for now – explore first</Text>
              </Box>
            </Box>
          </>
        )}

        {step === 'init' && (
          <>
            <Box flexDirection="column" marginY={1}>
              <Text bold color={colors.primary}>Initialize Project</Text>
            </Box>
            <Init
              active={mode === 'main'}
              autoStart={true}
              maxOutputLines={maxOutputLines}
              onInitComplete={() => setStep('complete')}
              showIdleMessage={false}
            />
          </>
        )}

        {step === 'complete' && (
          <>
            <Box flexDirection="column" marginY={1}>
              <Text bold color={colors.primary}>Welcome to ByteRover!</Text>
            </Box>
            <Box flexDirection="column" rowGap={1}>
              <Text color={colors.text}>
                Initialization complete! Your project is now set up with ByteRover.
              </Text>
              <EnterPrompt
                action="continue"
                active={mode === 'main'}
                onEnter={handleInitComplete}
              />
            </Box>
          </>
        )}
      </Box>
    </Box>
  )
}
