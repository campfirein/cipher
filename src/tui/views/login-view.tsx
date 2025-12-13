/**
 * Login View
 *
 * Three states:
 * 1. Idle: Prompt user to login
 * 2. Loading: Show spinner and output
 * 3. Completed: Show output and prompt to continue
 */

import {Box, Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useState} from 'react'

import {EnterPrompt, OutputLog} from '../components/index.js'
import {useAuth} from '../contexts/index.js'

type LoginState = 'completed' | 'idle' | 'loading'

export const LoginView: React.FC = () => {
  const {isLoggingIn, login, loginOutput, reloadAuth} = useAuth()
  const [hasStartedLogin, setHasStartedLogin] = useState(false)

  // Derive state from props and local state
  const state: LoginState = isLoggingIn ? 'loading' : hasStartedLogin ? 'completed' : 'idle'

  useInput((_, key) => {
    if (!key.return) return

    if (state === 'idle') {
      login()
      setHasStartedLogin(true)
    } else if (state === 'completed') {
      reloadAuth()
    }
  })

  return (
    <Box flexDirection="column" gap={1} paddingTop={1}>
      {/* Status message */}
      {state === 'idle' && <Text>You are not logged in.</Text>}
      {state === 'loading' && (
        <Box gap={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text>Logging in...</Text>
        </Box>
      )}

      {/* Output log */}
      {loginOutput.length > 0 && <OutputLog lines={loginOutput} />}

      {/* Action prompt */}
      {state === 'idle' && <EnterPrompt action="login" />}
      {state === 'completed' && <EnterPrompt action="continue" />}
    </Box>
  )
}
