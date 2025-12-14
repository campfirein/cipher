/**
 * Login View
 *
 * Three states:
 * 1. Idle: Prompt user to login
 * 2. Loading: Show spinner and output
 * 3. Completed: Show output and prompt to continue
 */

import {Box, Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useState} from 'react'

import {EnterPrompt, OutputLog} from '../components/index.js'
import {useAuth} from '../contexts/index.js'
import {useTheme} from '../contexts/use-theme.js'

type LoginState = 'completed' | 'idle' | 'loading'

export const LoginView: React.FC = () => {
  const {theme} = useTheme()
  const {isLoggingIn, login, loginOutput, reloadAuth} = useAuth()
  const [hasStartedLogin, setHasStartedLogin] = useState(false)

  // Derive state from props and local state
  const state: LoginState = isLoggingIn ? 'loading' : hasStartedLogin ? 'completed' : 'idle'

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
      {loginOutput.length > 0 && <OutputLog lines={loginOutput} logColor={theme.colors.text} />}

      {/* Action prompt */}
      {state === 'idle' && (
        <EnterPrompt
          action="login"
          onEnter={() => {
            login()
            setHasStartedLogin(true)
          }}
        />
      )}
      {state === 'completed' && <EnterPrompt action="continue" onEnter={() => reloadAuth()} />}
    </Box>
  )
}
