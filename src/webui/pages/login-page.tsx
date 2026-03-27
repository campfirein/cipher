import { Badge } from '@campfirein/byterover-packages/components/badge'
import { Button } from '@campfirein/byterover-packages/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@campfirein/byterover-packages/components/card'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { getAuthStateQueryOptions } from '../features/auth/api/get-auth-state'
import { login, subscribeToLoginCompleted } from '../features/auth/api/login'
import { useAuthStore } from '../features/auth/stores/auth-store'
import { useTransportStore } from '../stores/transport-store'

type LoginState =
  | { authUrl: string; type: 'waiting' }
  | { message: string; success: boolean; type: 'result' }
  | { type: 'idle' }
  | { type: 'starting' }

function isSafeHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const isAuthorized = useAuthStore((state) => state.isAuthorized)
  const isLoggingIn = useAuthStore((state) => state.isLoggingIn)
  const setLoggingIn = useAuthStore((state) => state.setLoggingIn)
  const connectionState = useTransportStore((state) => state.connectionState)
  const [state, setState] = useState<LoginState>({ type: 'idle' })

  const redirectTo =
    typeof location.state === 'object' &&
      location.state &&
      'from' in location.state &&
      location.state.from &&
      typeof location.state.from === 'object' &&
      'pathname' in location.state.from
      ? String(location.state.from.pathname)
      : '/status'

  useEffect(() => {
    if (state.type !== 'waiting') return

    const unsubscribe = subscribeToLoginCompleted((data) => {
      if (data.success && data.user) {
        setState({ message: `Logged in as ${data.user.email}`, success: true, type: 'result' })
      } else {
        setState({ message: data.error ?? 'Authentication failed', success: false, type: 'result' })
      }

      setLoggingIn(false)
    })

    return unsubscribe
  }, [setLoggingIn, state.type])

  if (isAuthorized) {
    return <Navigate replace to={redirectTo} />
  }

  async function handleStartLogin() {
    setLoggingIn(true)
    setState({ type: 'starting' })

    try {
      const response = await login()
      if (!isSafeHttpUrl(response.authUrl)) {
        throw new Error('Received an unsafe OAuth URL from the daemon')
      }

      window.open(response.authUrl, '_blank', 'noopener,noreferrer')
      setState({ authUrl: response.authUrl, type: 'waiting' })
    } catch (error) {
      setLoggingIn(false)
      setState({
        message: error instanceof Error ? error.message : 'Unable to start login',
        success: false,
        type: 'result',
      })
    }
  }

  async function handleContinue() {
    if (state.type !== 'result') return

    if (state.success) {
      await queryClient.invalidateQueries({ queryKey: getAuthStateQueryOptions().queryKey })
      navigate(redirectTo)
      return
    }

    setState({ type: 'idle' })
  }

  return (
    <div className="grid grid-rows-[auto_1fr_auto] min-w-0">
      <main className="px-6 pb-6 min-w-0">
        <div className="grid gap-4 grid-cols-2">
          <Card className="shadow-sm ring-border/70" size="sm">
            <CardHeader>
              <div>
                <CardTitle className="text-3xl font-bold leading-none">Sign In</CardTitle>
                <CardDescription>Authenticate once, then the protected panel routes unlock.</CardDescription>
              </div>
              <div className="justify-self-end">
                <Badge className={connectionState === 'connected' ? 'rounded-sm border-transparent bg-primary/10 text-primary' : connectionState === 'reconnecting' ? 'rounded-sm border-yellow-500/20 bg-yellow-500/10 text-yellow-600' : 'rounded-sm border-destructive/20 bg-destructive/10 text-destructive'} variant="outline">
                  {connectionState}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              <p>
                This web UI reuses the same transport/auth flow as the TUI. Login starts in the daemon, opens your
                browser, then waits for the daemon to confirm that authentication completed.
              </p>

              {state.type === 'result' && (
                <div className={state.success ? 'p-4 border border-primary/20 rounded-xl bg-primary/5 text-primary' : 'p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive'}>
                  {state.message}
                </div>
              )}

              {state.type === 'waiting' && (
                <div className="p-4 border border-blue-500/20 rounded-xl bg-blue-50 text-blue-700">
                  <p>Finish authentication in the browser tab that just opened.</p>
                  <p>
                    If the tab did not open, use{' '}
                    <a href={state.authUrl} rel="noreferrer" target="_blank">
                      this OAuth link
                    </a>
                    .
                  </p>
                </div>
              )}

              {state.type === 'starting' && <div className="p-4 border border-blue-500/20 rounded-xl bg-blue-50 text-blue-700">Starting authentication…</div>}

              <div className="flex flex-wrap gap-2.5">
                {state.type === 'result' ? (
                  <Button className="cursor-pointer" onClick={handleContinue} size="lg">
                    {state.success ? 'Continue' : 'Try again'}
                  </Button>
                ) : (
                  <Button
                    className="cursor-pointer" disabled={connectionState !== 'connected' || isLoggingIn}
                    onClick={handleStartLogin}
                    size="lg"
                  >
                    {isLoggingIn ? 'Starting…' : 'Start login'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm ring-border/70" size="sm">
            <CardHeader>
              <div>
                <CardTitle className="font-semibold">What to expect</CardTitle>
                <CardDescription>A short checklist so the flow feels predictable.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
                  <div className="text-xs tracking-wider uppercase text-muted-foreground">1</div>
                  <div className="break-words">The daemon creates an OAuth URL over Socket.IO.</div>
                </Card>
                <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
                  <div className="text-xs tracking-wider uppercase text-muted-foreground">2</div>
                  <div className="break-words">Your browser finishes authentication with ByteRover.</div>
                </Card>
                <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
                  <div className="text-xs tracking-wider uppercase text-muted-foreground">3</div>
                  <div className="break-words">The web app listens for the daemon&apos;s login-complete signal and refreshes state.</div>
                </Card>
                <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
                  <div className="text-xs tracking-wider uppercase text-muted-foreground">4</div>
                  <div className="break-words">Protected routes redirect you straight into the status page.</div>
                </Card>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
