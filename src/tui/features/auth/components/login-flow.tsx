/**
 * LoginFlow Component
 *
 * Starts OAuth login, waits for browser callback, reports result.
 */

import {Text} from 'ink'
import Spinner from 'ink-spinner'
import React, {useEffect, useState} from 'react'

import type {AuthLoginCompletedEvent} from '../../../../shared/transport/events/index.js'
import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {AuthEvents} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {login} from '../api/login.js'

type LoginStep = 'starting' | 'waiting'

export function LoginFlow({onComplete}: CustomDialogCallbacks): React.ReactNode {
  const [step, setStep] = useState<LoginStep>('starting')
  const [authUrl, setAuthUrl] = useState<string>()

  // Start the login process
  useEffect(() => {
    login()
      .then((data) => {
        setAuthUrl(data.authUrl)
        setStep('waiting')
      })
      .catch((_error) => {
        // onComplete(`Login failed: ${_error.message}`)
      })
  }, [])

  // Subscribe to login completion event
  useEffect(() => {
    if (step !== 'waiting') return

    const {apiClient} = useTransportStore.getState()
    if (!apiClient) {
      onComplete('Login failed: Not connected')
      return
    }

    const unsubscribe = apiClient.on<AuthLoginCompletedEvent>(AuthEvents.LOGIN_COMPLETED, (data) => {
      unsubscribe()
      if (data.success && data.user) {
        onComplete(`Logged in as ${data.user.email}`)
      } else {
        onComplete(data.error ?? 'Authentication failed')
      }
    })

    return unsubscribe
  }, [onComplete, step])

  // if (step === 'starting') {
  //   return (
  //     <Text>
  //       {isLoggingIn && (
  //         <>
  //           <Spinner type="dots" /> Starting authentication process...
  //         </>
  //       )}
  //       {loginError && <Text color="red">{loginError.message}</Text>}
  //     </Text>
  //   )
  // }

  return (
    <Text>
      <Spinner type="dots" /> Opening browser for authentication...
      {authUrl ? `\nIf the browser did not open, visit: ${authUrl}` : ''}
    </Text>
  )
}
