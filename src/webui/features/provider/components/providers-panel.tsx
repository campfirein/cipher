import { Badge } from '@campfirein/byterover-packages/components/badge'
import { Button } from '@campfirein/byterover-packages/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@campfirein/byterover-packages/components/card'
import { Input } from '@campfirein/byterover-packages/components/input'
import { useEffect, useState } from 'react'

import type { ProviderDTO } from '../../../../shared/transport/types/dto'

import { useAwaitOAuthCallback } from '../api/await-oauth-callback'
import { useConnectProvider } from '../api/connect-provider'
import { useDisconnectProvider } from '../api/disconnect-provider'
import { useGetProviders } from '../api/get-providers'
import { useSetActiveProvider } from '../api/set-active-provider'
import { useStartOAuth } from '../api/start-oauth'
import { useSubmitOAuthCode } from '../api/submit-oauth-code'
import { useValidateApiKey } from '../api/validate-api-key'
import { useProviderStore } from '../stores/provider-store'

function isSafeHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

type Feedback = {
  text: string
  tone: 'error' | 'info' | 'success' | 'warning'
}

export function ProvidersPanel() {
  const [expandedProviderId, setExpandedProviderId] = useState<null | string>(null)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [oauthCode, setOAuthCode] = useState('')
  const [oauthUrl, setOAuthUrl] = useState<null | string>(null)
  const [oauthCallbackMode, setOAuthCallbackMode] = useState<'auto' | 'code-paste' | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const { data, error, isFetching, isLoading, refetch } = useGetProviders()
  const connectMutation = useConnectProvider()
  const disconnectMutation = useDisconnectProvider()
  const setActiveMutation = useSetActiveProvider()
  const validateApiKeyMutation = useValidateApiKey()
  const startOAuthMutation = useStartOAuth()
  const awaitOAuthCallbackMutation = useAwaitOAuthCallback()
  const submitOAuthCodeMutation = useSubmitOAuthCode()

  useEffect(() => {
    if (!data) return
    useProviderStore.getState().setProviders(data.providers)
    const activeProvider = data.providers.find((provider) => provider.isCurrent)
    useProviderStore.getState().setActiveProviderId(activeProvider?.id ?? null)
  }, [data])

  const providers = [...(data?.providers ?? [])].sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1
    if (left.isConnected !== right.isConnected) return left.isConnected ? -1 : 1
    if (left.category !== right.category) return left.category === 'popular' ? -1 : 1
    return left.name.localeCompare(right.name)
  })

  function openEditor(provider: ProviderDTO) {
    setExpandedProviderId(provider.id)
    setApiKey('')
    setBaseUrl('')
    setOAuthCode('')
    setOAuthUrl(null)
    setOAuthCallbackMode(provider.oauthCallbackMode ?? null)
    setFeedback(null)
  }

  async function handleValidate(providerId: string) {
    if (!apiKey.trim()) {
      setFeedback({ text: 'Enter an API key before validating.', tone: 'warning' })
      return
    }

    try {
      const result = await validateApiKeyMutation.mutateAsync({ apiKey: apiKey.trim(), providerId })
      setFeedback({
        text: result.isValid ? 'The daemon accepted this API key.' : result.error ?? 'The API key was rejected.',
        tone: result.isValid ? 'success' : 'error',
      })
    } catch (validationError) {
      setFeedback({
        text: validationError instanceof Error ? validationError.message : 'Validation failed',
        tone: 'error',
      })
    }
  }

  async function handleConnect(providerId: string) {
    if (!apiKey.trim()) {
      setFeedback({ text: 'An API key is required before connecting this provider.', tone: 'warning' })
      return
    }

    try {
      await connectMutation.mutateAsync({
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || undefined,
        providerId,
      })
      setFeedback({ text: 'Provider connected successfully.', tone: 'success' })
      setApiKey('')
    } catch (connectError) {
      setFeedback({
        text: connectError instanceof Error ? connectError.message : 'Failed to connect provider',
        tone: 'error',
      })
    }
  }

  async function handleDisconnect(providerId: string) {
    try {
      await disconnectMutation.mutateAsync({ providerId })
      setFeedback({ text: 'Provider disconnected.', tone: 'success' })
      if (expandedProviderId === providerId) {
        setExpandedProviderId(null)
      }
    } catch (disconnectError) {
      setFeedback({
        text: disconnectError instanceof Error ? disconnectError.message : 'Failed to disconnect provider',
        tone: 'error',
      })
    }
  }

  async function handleSetActive(providerId: string) {
    try {
      await setActiveMutation.mutateAsync({ providerId })
      useProviderStore.getState().setActiveProviderId(providerId)
      setFeedback({ text: 'Active provider updated.', tone: 'success' })
    } catch (activationError) {
      setFeedback({
        text: activationError instanceof Error ? activationError.message : 'Failed to set active provider',
        tone: 'error',
      })
    }
  }

  async function handleStartOAuth(provider: ProviderDTO) {
    openEditor(provider)

    try {
      const result = await startOAuthMutation.mutateAsync({ providerId: provider.id })
      if (!result.success) {
        setFeedback({ text: result.error ?? 'OAuth could not be started.', tone: 'error' })
        return
      }

      if (!isSafeHttpUrl(result.authUrl)) {
        setFeedback({ text: 'The daemon returned an unsafe OAuth URL.', tone: 'error' })
        return
      }

      setOAuthUrl(result.authUrl)
      setOAuthCallbackMode(result.callbackMode)
      window.open(result.authUrl, '_blank', 'noopener,noreferrer')

      if (result.callbackMode === 'auto') {
        setFeedback({ text: 'Waiting for the OAuth callback from your browser…', tone: 'info' })
        const callbackResult = await awaitOAuthCallbackMutation.mutateAsync({ providerId: provider.id })
        if (callbackResult.success) {
          setFeedback({ text: 'OAuth completed and the provider is now connected.', tone: 'success' })
        } else {
          setFeedback({ text: callbackResult.error ?? 'OAuth callback failed.', tone: 'error' })
        }

        return
      }

      setFeedback({
        text: 'Complete the flow in your browser, then paste the authorization code here.',
        tone: 'info',
      })
    } catch (oauthError) {
      setFeedback({
        text: oauthError instanceof Error ? oauthError.message : 'OAuth failed',
        tone: 'error',
      })
    }
  }

  async function handleSubmitOAuthCode(providerId: string) {
    if (!oauthCode.trim()) {
      setFeedback({ text: 'Paste the authorization code before submitting.', tone: 'warning' })
      return
    }

    try {
      const result = await submitOAuthCodeMutation.mutateAsync({ code: oauthCode.trim(), providerId })
      if (result.success) {
        setFeedback({ text: 'OAuth code accepted and the provider is connected.', tone: 'success' })
        setOAuthCode('')
      } else {
        setFeedback({ text: result.error ?? 'OAuth code was rejected.', tone: 'error' })
      }
    } catch (submitError) {
      setFeedback({
        text: submitError instanceof Error ? submitError.message : 'Failed to submit OAuth code',
        tone: 'error',
      })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="shadow-sm ring-border/70" size="sm">
        <CardHeader>
          <div>
            <CardTitle className="font-semibold">Connected providers</CardTitle>
            <CardDescription>API key and OAuth flows use the same transport events as the TUI.</CardDescription>
          </div>
          <CardAction className="flex flex-wrap gap-2.5">
            <Button className="cursor-pointer" disabled={isFetching} onClick={() => refetch()} size="lg">
              {isFetching ? 'Refreshing…' : 'Refresh'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isLoading ? <div className="p-4 border border-blue-500/20 rounded-xl bg-blue-50 text-blue-700">Loading providers…</div> : null}
          {error ? <div className="p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive">{error.message}</div> : null}
          {feedback ? <div className={feedback.tone === 'error' ? 'p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive' : feedback.tone === 'info' ? 'p-4 border border-blue-500/20 rounded-xl bg-blue-50 text-blue-700' : feedback.tone === 'success' ? 'p-4 border border-primary/20 rounded-xl bg-primary/5 text-primary' : 'p-4 border border-yellow-500/20 rounded-xl bg-yellow-50 text-yellow-700'}>{feedback.text}</div> : null}
        </CardContent>
      </Card>

      <section className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(17rem,1fr))]">
        {providers.map((provider) => {
          const isExpanded = expandedProviderId === provider.id

          return (
            <Card
              className={provider.isCurrent ? 'gap-3 px-4 shadow-none ring-primary/30 bg-primary/5' : 'gap-3 px-4 shadow-none ring-border/80'}
              key={provider.id}
              size="sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="font-semibold">{provider.name}</CardTitle>
                  <CardDescription>{provider.description}</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge className={provider.isConnected ? 'rounded-sm border-transparent bg-primary/10 text-primary' : 'rounded-sm border-destructive/20 bg-destructive/10 text-destructive'} variant="outline">
                    {provider.isConnected ? 'Connected' : 'Not connected'}
                  </Badge>
                  {provider.isCurrent ? <Badge className="rounded-sm border-blue-500/20 bg-blue-500/10 text-blue-600" variant="outline">Active</Badge> : null}
                  {provider.supportsOAuth ? <Badge className="rounded-sm border-yellow-500/20 bg-yellow-500/10 text-yellow-600" variant="outline">OAuth</Badge> : null}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
                  <div className="text-xs tracking-wider uppercase text-muted-foreground">Auth method</div>
                  <div className="break-words">{provider.authMethod ?? 'Not configured'}</div>
                </Card>
                <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
                  <div className="text-xs tracking-wider uppercase text-muted-foreground">Category</div>
                  <div className="break-words">{provider.category}</div>
                </Card>
              </div>

              <div className="flex flex-wrap gap-2.5">
                {!provider.isCurrent && provider.isConnected ? (
                  <Button className="cursor-pointer" onClick={() => handleSetActive(provider.id)} size="lg">
                    Use provider
                  </Button>
                ) : null}

                {provider.requiresApiKey && !provider.isConnected ? (
                  <Button className="cursor-pointer" onClick={() => openEditor(provider)} size="lg" variant="outline">
                    API key setup
                  </Button>
                ) : null}

                {provider.supportsOAuth && !provider.isConnected ? (
                  <Button className="cursor-pointer" onClick={() => handleStartOAuth(provider)} size="lg" variant="outline">
                    Start OAuth
                  </Button>
                ) : null}

                {provider.isConnected ? (
                  <Button className="cursor-pointer" onClick={() => handleDisconnect(provider.id)} size="lg" variant="ghost">
                    Disconnect
                  </Button>
                ) : null}
              </div>

              {isExpanded ? (
                <div className="flex flex-col gap-4">
                  {provider.requiresApiKey ? (
                    <div className="grid gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-semibold text-muted-foreground" htmlFor={`${provider.id}-api-key`}>
                          API key
                        </label>
                        <Input
                          className="h-10 rounded-lg bg-background px-3"
                          id={`${provider.id}-api-key`}
                          onChange={(event) => setApiKey(event.target.value)}
                          placeholder="Paste the provider API key"
                          type="password"
                          value={apiKey}
                        />
                        {provider.apiKeyUrl ? (
                          <span className="text-sm text-muted-foreground">
                            Need a key?{' '}
                            <a href={provider.apiKeyUrl} rel="noreferrer" target="_blank">
                              Open the provider dashboard
                            </a>
                            .
                          </span>
                        ) : null}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-semibold text-muted-foreground" htmlFor={`${provider.id}-base-url`}>
                          Base URL
                        </label>
                        <Input
                          className="h-10 rounded-lg bg-background px-3"
                          id={`${provider.id}-base-url`}
                          onChange={(event) => setBaseUrl(event.target.value)}
                          placeholder="Optional override for self-hosted or compatible endpoints"
                          value={baseUrl}
                        />
                      </div>

                      <div className="flex flex-wrap gap-2.5">
                        <Button className="cursor-pointer" onClick={() => handleValidate(provider.id)} size="lg" variant="outline">
                          Validate key
                        </Button>
                        <Button className="cursor-pointer" onClick={() => handleConnect(provider.id)} size="lg">
                          Connect provider
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {provider.supportsOAuth ? (
                    <Card className="shadow-none ring-border/80" size="sm">
                      <CardHeader>
                        <div>
                          <CardTitle className="font-semibold">OAuth flow</CardTitle>
                          <CardDescription>
                            {oauthCallbackMode === 'code-paste'
                              ? 'This provider expects an authorization code.'
                              : 'This provider completes automatically after the browser callback.'}
                          </CardDescription>
                        </div>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-4">
                        {oauthUrl ? (
                          <div className="p-4 border border-blue-500/20 rounded-xl bg-blue-50 text-blue-700">
                            OAuth URL:{' '}
                            <a href={oauthUrl} rel="noreferrer" target="_blank">
                              {oauthUrl}
                            </a>
                          </div>
                        ) : null}

                        {oauthCallbackMode === 'code-paste' ? (
                          <div className="grid gap-3">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-sm font-semibold text-muted-foreground" htmlFor={`${provider.id}-oauth-code`}>
                                Authorization code
                              </label>
                              <Input
                                className="h-10 rounded-lg bg-background px-3"
                                id={`${provider.id}-oauth-code`}
                                onChange={(event) => setOAuthCode(event.target.value)}
                                placeholder="Paste the code returned by the provider"
                                value={oauthCode}
                              />
                            </div>

                            <div className="flex flex-wrap gap-2.5">
                              <Button className="cursor-pointer" onClick={() => handleSubmitOAuthCode(provider.id)} size="lg">
                                Submit code
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              ) : null}
            </Card>
          )
        })}
      </section>
    </div>
  )
}
