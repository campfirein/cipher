import { Button } from '@campfirein/byterover-packages/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@campfirein/byterover-packages/components/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campfirein/byterover-packages/components/dialog'
import {useEffect, useState} from 'react'

import {createSession, subscribeToNewSessionCreated} from '../api/create-session'

type Feedback = {
  text: string
  tone: 'error' | 'info' | 'success'
}

export function SessionPanel() {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [isWaitingForCreation, setIsWaitingForCreation] = useState(false)

  useEffect(() => {
    if (!isWaitingForCreation) return

    const unsubscribe = subscribeToNewSessionCreated((data) => {
      if (data.success) {
        setFeedback({
          text: data.sessionId ? `Fresh session created: ${data.sessionId}` : 'Fresh session created.',
          tone: 'success',
        })
      } else {
        setFeedback({text: data.error ?? 'Session creation failed.', tone: 'error'})
      }

      setIsWaitingForCreation(false)
    })

    return unsubscribe
  }, [isWaitingForCreation])

  async function handleCreateSession() {
    setIsConfirmOpen(false)
    setIsWaitingForCreation(true)
    setFeedback({text: 'New session request sent. Waiting for the daemon to confirm creation…', tone: 'info'})

    try {
      const response = await createSession({reason: 'User requested new session from web UI'})
      if (!response.success) {
        setFeedback({text: response.error ?? 'Unable to request a new session.', tone: 'error'})
        setIsWaitingForCreation(false)
        return
      }

      if (!response.sessionId) {
        setFeedback({
          text: 'New session request accepted. If no agent is running yet, the next interaction will start fresh.',
          tone: 'info',
        })
      }
    } catch (createError) {
      setFeedback({
        text: createError instanceof Error ? createError.message : 'Unable to create a new session',
        tone: 'error',
      })
      setIsWaitingForCreation(false)
    }
  }

  return (
    <>
      <Card className="shadow-sm ring-border/70" size="sm">
        <CardHeader>
          <div>
            <CardTitle className="font-semibold">Fresh session</CardTitle>
            <CardDescription>
              The current transport surface exposes new-session creation through `agent:newSession` and its broadcast completion event.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
              <div className="text-xs tracking-wider uppercase text-muted-foreground">Current support</div>
              <div className="break-words">Request a fresh session and wait for daemon confirmation.</div>
            </Card>
            <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
              <div className="text-xs tracking-wider uppercase text-muted-foreground">Not yet exposed</div>
              <div className="break-words">Session list/info/switch transport handlers are not wired in the daemon yet.</div>
            </Card>
          </div>

          {feedback ? <div className={feedback.tone === 'error' ? 'p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive' : feedback.tone === 'info' ? 'p-4 border border-blue-500/20 rounded-xl bg-blue-50 text-blue-700' : 'p-4 border border-primary/20 rounded-xl bg-primary/5 text-primary'}>{feedback.text}</div> : null}

          <div className="flex flex-wrap gap-2.5">
            <Button className="cursor-pointer" disabled={isWaitingForCreation} onClick={() => setIsConfirmOpen(true)} size="lg">
              {isWaitingForCreation ? 'Creating…' : 'Start new session'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog onOpenChange={(open) => { if (!open) setIsConfirmOpen(false) }} open={isConfirmOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Start a fresh session?</DialogTitle>
            <DialogDescription>
              This ends the current conversation session and asks the daemon/agent pair to start fresh.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button className="cursor-pointer" variant="ghost" />}>
              Cancel
            </DialogClose>
            <Button className="cursor-pointer" onClick={handleCreateSession} size="lg">
              Start new session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
