import {Box, Text, useInput} from 'ink'
import React, {useCallback, useEffect, useRef, useState} from 'react'

import type {ProviderDTO} from '../../../../shared/transport/types/dto.js'

import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'
import {formatTransportError} from '../../../utils/index.js'
import {useAwaitOAuthCallback} from '../api/await-oauth-callback.js'
import {cancelOAuth} from '../api/cancel-oauth.js'
import {useStartOAuth} from '../api/start-oauth.js'

type OAuthStep = 'error' | 'starting' | 'waiting'

interface ErrorAction {
  id: 'cancel' | 'retry'
  name: string
}

export interface OAuthDialogProps {
  isActive?: boolean
  onCancel: () => void
  onSuccess: () => void
  provider: ProviderDTO
}

export const OAuthDialog: React.FC<OAuthDialogProps> = ({
  isActive = true,
  onCancel,
  onSuccess,
  provider,
}) => {
  const {theme: {colors}} = useTheme()
  const [step, setStep] = useState<OAuthStep>('starting')
  const [authUrl, setAuthUrl] = useState<null | string>(null)
  const [error, setError] = useState<null | string>(null)
  const mounted = useRef(true)
  const flowStarted = useRef(false)
  const providerIdRef = useRef(provider.id)
  providerIdRef.current = provider.id

  const startOAuthMutation = useStartOAuth()
  const awaitCallbackMutation = useAwaitOAuthCallback()

  const runOAuthFlow = useCallback(async () => {
    if (!mounted.current) return

    setStep('starting')
    setError(null)

    try {
      const startResult = await startOAuthMutation.mutateAsync({providerId: provider.id})
      if (!mounted.current) return

      if (!startResult.success) {
        setError(startResult.error ?? 'Failed to start OAuth flow')
        setStep('error')
        return
      }

      flowStarted.current = true
      setAuthUrl(startResult.authUrl)
      setStep('waiting')

      const callbackResult = await awaitCallbackMutation.mutateAsync({providerId: provider.id})
      if (!mounted.current) return

      if (callbackResult.success) {
        onSuccess()
      } else {
        setError(callbackResult.error ?? 'OAuth authentication failed')
        setStep('error')
      }
    } catch (error_) {
      if (!mounted.current) return
      setError(formatTransportError(error_))
      setStep('error')
    }
  }, [awaitCallbackMutation, onSuccess, provider.id, startOAuthMutation])

  useEffect(() => {
    runOAuthFlow()

    return () => {
      mounted.current = false
      if (flowStarted.current) {
        cancelOAuth({providerId: providerIdRef.current}).catch(() => {})
      }
    }
  }, [])

  useInput((_input, key) => {
    if (key.escape && isActive && step === 'waiting') {
      onCancel()
    }
  })

  const handleErrorAction = useCallback((action: ErrorAction) => {
    if (action.id === 'retry') {
      runOAuthFlow()
    } else {
      onCancel()
    }
  }, [onCancel, runOAuthFlow])

  const errorActions: ErrorAction[] = [
    {id: 'retry', name: 'Retry'},
    {id: 'cancel', name: 'Cancel'},
  ]

  switch (step) {
    case 'error': {
      return (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={colors.warning}>{error}</Text>
          </Box>
          <SelectableList<ErrorAction>
            filterKeys={(item) => [item.id, item.name]}
            isActive={isActive}
            items={errorActions}
            keyExtractor={(item) => item.id}
            onCancel={onCancel}
            onSelect={handleErrorAction}
            renderItem={(item, isItemActive) => (
              <Text
                backgroundColor={isItemActive ? colors.dimText : undefined}
                color={colors.text}
              >
                {item.name}
              </Text>
            )}
            title="OAuth failed"
          />
        </Box>
      )
    }

    case 'starting': {
      return (
        <Box>
          <Text color={colors.primary}>Starting OAuth flow for {provider.name}...</Text>
        </Box>
      )
    }

    case 'waiting': {
      return (
        <Box flexDirection="column" gap={1}>
          <Text color={colors.primary}>Opening browser for authentication...</Text>
          {authUrl && (
            <Box flexDirection="column">
              <Text color={colors.dimText}>If the browser did not open, visit this URL:</Text>
              <Text color={colors.info}>{authUrl}</Text>
            </Box>
          )}
          <Text color={colors.dimText}>Waiting for authorization... (press Esc to cancel)</Text>
        </Box>
      )
    }

    default: {
      return null
    }
  }
}
