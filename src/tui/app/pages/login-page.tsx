/**
 * Login Page
 *
 * Public route for unauthenticated users.
 * Handles OAuth login flow with four states:
 * - idle: Shows "not logged in" message with enter prompt
 * - starting: Shows "starting authentication"
 * - waiting: Shows "opening browser" with auth URL fallback
 * - result: Shows success/failure message with enter to continue/retry
 */

import {useQueryClient} from '@tanstack/react-query'
import {Box, Text} from 'ink'
import React, {useCallback, useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {EnterPrompt, Header} from '../../components/index.js'
import {getAuthStateQueryOptions} from '../../features/auth/api/get-auth-state.js'
import {login, subscribeToLoginCompleted} from '../../features/auth/api/login.js'
import {useAuthStore} from '../../features/auth/stores/auth-store.js'
import {useTasksStore} from '../../features/tasks/stores/tasks-store.js'
import {useTerminalBreakpoint, useUIHeights} from '../../hooks/index.js'

type LoginState =
  | {authUrl: string; type: 'waiting'}
  | {message: string; success: boolean; type: 'result'}
  | {type: 'idle'}
  | {type: 'starting'}

export function LoginPage(): React.ReactNode {
  const {rows: terminalHeight} = useTerminalBreakpoint()
  const {appBottomPadding} = useUIHeights()
  const queryClient = useQueryClient()
  const clearTasks = useTasksStore((s) => s.clearTasks)
  const navigate = useNavigate()

  const isAuthorized = useAuthStore((s) => s.isAuthorized)
  const [state, setState] = useState<LoginState>({type: 'idle'})

  // Navigate to home when auth changes externally (e.g., login from another TUI)
  useEffect(() => {
    if (isAuthorized && state.type === 'idle') {
      // Sync React Query cache with zustand auth state so downstream components
      // (e.g., LogoutFlow) have fresh data without needing a daemon round-trip.
      const {brvConfig, user} = useAuthStore.getState()
      queryClient.setQueryData(getAuthStateQueryOptions().queryKey, {
        brvConfig: brvConfig ?? undefined,
        isAuthorized: true,
        user: user ?? undefined,
      })
      navigate('/')
    }
  }, [isAuthorized, navigate, queryClient, state.type])

  const handleStartLogin = useCallback(() => {
    setState({type: 'starting'})
  }, [])

  const handleResultContinue = useCallback(async () => {
    if (state.type !== 'result') return

    if (state.success) {
      clearTasks()
      await queryClient.invalidateQueries({queryKey: getAuthStateQueryOptions().queryKey})
      navigate('/')
    } else {
      setState({type: 'idle'})
    }
  }, [clearTasks, navigate, queryClient, state])

  // Start the login process when entering 'starting' state
  useEffect(() => {
    if (state.type !== 'starting') return

    login()
      .then((data) => setState({authUrl: data.authUrl, type: 'waiting'}))
      .catch((error) => setState({message: error.message, success: false, type: 'result'}))
  }, [login, state.type])

  // Subscribe to login completion event when waiting for browser callback
  useEffect(() => {
    if (state.type !== 'waiting') return

    const unsubscribe = subscribeToLoginCompleted((data) => {
      unsubscribe()
      if (data.success && data.user) {
        setState({message: `Logged in as ${data.user.email}`, success: true, type: 'result'})
      } else {
        setState({message: data.error ?? 'Authentication failed', success: false, type: 'result'})
      }
    })

    if (!unsubscribe) {
      setState({message: 'Not connected to server', success: false, type: 'result'})
      return
    }

    return unsubscribe
  }, [state.type])

  return (
    <Box flexDirection="column" height={terminalHeight} paddingBottom={appBottomPadding}>
      <Box flexShrink={0}>
        <Header compact={false} />
      </Box>

      <Box flexGrow={1} paddingX={1}>
        {state.type === 'idle' && (
          <Box flexDirection="column" gap={1}>
            <Text>You are not logged in.</Text>
            <EnterPrompt action="login" onEnter={handleStartLogin} />
          </Box>
        )}

        {state.type === 'result' && (
          <Box flexDirection="column" gap={1}>
            <Text color={state.success ? 'green' : 'red'}>{state.message}</Text>
            <EnterPrompt action={state.success ? 'continue' : 'retry'} onEnter={handleResultContinue} />
          </Box>
        )}

        {state.type === 'starting' && <Text>Starting authentication process...</Text>}

        {state.type === 'waiting' && (
          <Box flexDirection="column" gap={1}>
            <Text>Opening browser for authentication...</Text>
            <Text dimColor>If the browser did not open, visit: {state.authUrl}</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
