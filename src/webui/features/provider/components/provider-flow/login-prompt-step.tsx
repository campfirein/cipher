import {Button} from '@campfirein/byterover-packages/components/button'
import {DialogFooter, DialogHeader, DialogTitle} from '@campfirein/byterover-packages/components/dialog'
import {useQueryClient} from '@tanstack/react-query'
import {ChevronLeft, LoaderCircle} from 'lucide-react'
import {useEffect, useState} from 'react'

import {getAuthStateQueryOptions} from '../../../auth/api/get-auth-state'
import {login, subscribeToLoginCompleted} from '../../../auth/api/login'
import {useAuthStore} from '../../../auth/stores/auth-store'
import {isSafeHttpUrl} from '../../../auth/utils/is-safe-http-url'

interface LoginPromptStepProps {
  onAuthenticated: () => void
  onBack: () => void
}

type InnerState =
  | {authUrl: string; type: 'waiting'}
  | {message: string; type: 'error'}
  | {type: 'idle'}
  | {type: 'starting'}

const POLL_INTERVAL_MS = 2500

export function LoginPromptStep({onAuthenticated, onBack}: LoginPromptStepProps) {
  const queryClient = useQueryClient()
  const isAuthorized = useAuthStore((s) => s.isAuthorized)
  const setLoggingIn = useAuthStore((s) => s.setLoggingIn)
  const [state, setState] = useState<InnerState>({type: 'idle'})

  // Auto-continue once auth flips to authorized (from LOGIN_COMPLETED or poll).
  useEffect(() => {
    if (isAuthorized && state.type === 'waiting') {
      setLoggingIn(false)
      onAuthenticated()
    }
  }, [isAuthorized, onAuthenticated, setLoggingIn, state.type])

  useEffect(() => {
    if (state.type !== 'waiting') return

    const unsubscribe = subscribeToLoginCompleted((data) => {
      if (data.success && data.user) {
        queryClient.invalidateQueries({queryKey: getAuthStateQueryOptions().queryKey})
      } else {
        setState({message: data.error ?? 'Authentication failed', type: 'error'})
      }

      setLoggingIn(false)
    })

    return unsubscribe
  }, [queryClient, setLoggingIn, state.type])

  // Fallback poll in case LOGIN_COMPLETED is missed.
  useEffect(() => {
    if (state.type !== 'waiting') return

    let cancelled = false

    async function poll() {
      try {
        const result = await queryClient.fetchQuery(getAuthStateQueryOptions())
        if (cancelled) return
        if (result.isAuthorized) {
          queryClient.invalidateQueries({queryKey: getAuthStateQueryOptions().queryKey})
          setLoggingIn(false)
        }
      } catch {
        // next tick retries
      }
    }

    const intervalId = globalThis.setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      globalThis.clearInterval(intervalId)
    }
  }, [queryClient, setLoggingIn, state.type])

  async function handleSignIn() {
    setLoggingIn(true)
    // Open the popup synchronously to keep the user-gesture context — browsers
    // block window.open() if it lands inside an async callback.
    const popup = window.open('', '_blank', 'noopener,noreferrer')
    setState({type: 'starting'})

    try {
      const response = await login()
      if (!isSafeHttpUrl(response.authUrl)) {
        popup?.close()
        throw new Error('Received an unsafe OAuth URL from the daemon')
      }

      if (popup) {
        popup.location.href = response.authUrl
      } else {
        window.open(response.authUrl, '_blank', 'noopener,noreferrer')
      }

      setState({authUrl: response.authUrl, type: 'waiting'})
    } catch (error) {
      setLoggingIn(false)
      setState({
        message: error instanceof Error ? error.message : 'Unable to start login',
        type: 'error',
      })
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <button className="hover:bg-muted rounded p-0.5 transition-colors" onClick={onBack} type="button">
            <ChevronLeft className="size-5" />
          </button>
          Sign in to ByteRover
        </DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          ByteRover requires authentication before it can be used as a provider. Sign in to your{' '}
          <span className="text-foreground">byterover.dev</span> account to continue.
        </p>

        {state.type === 'starting' && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-sm text-blue-700">
            <LoaderCircle className="size-4 animate-spin" />
            Starting authentication…
          </div>
        )}

        {state.type === 'waiting' && (
          <div className="flex flex-col gap-1 rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2 text-sm">
              <LoaderCircle className="text-primary size-4 animate-spin" />
              Finish signing in in the new tab.
            </div>
            <div className="text-muted-foreground pl-6 text-xs">
              If the tab didn&rsquo;t open,{' '}
              <a className="underline underline-offset-2" href={state.authUrl} rel="noopener noreferrer" target="_blank">
                click this link
              </a>
              .
            </div>
          </div>
        )}

        {state.type === 'error' && (
          <div className="text-destructive bg-destructive/10 rounded-lg px-4 py-2.5 text-sm">{state.message}</div>
        )}
      </div>

      <DialogFooter className="mt-auto">
        <Button onClick={onBack} variant="secondary">
          Cancel
        </Button>
        {state.type === 'error' ? (
          <Button onClick={() => setState({type: 'idle'})}>Try again</Button>
        ) : (
          <Button disabled={state.type === 'starting' || state.type === 'waiting'} onClick={handleSignIn}>
            {state.type === 'waiting' ? 'Waiting…' : 'Sign in'}
          </Button>
        )}
      </DialogFooter>
    </div>
  )
}
