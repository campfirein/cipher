import { Button } from '@campfirein/byterover-packages/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@campfirein/byterover-packages/components/card'
import { Input } from '@campfirein/byterover-packages/components/input'
import {useState} from 'react'

import type {PushProgressEvent} from '../../../../shared/transport/events'

import {PushEvents} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'
import {useExecutePush} from '../api/execute-push'
import {usePreparePush} from '../api/prepare-push'

type Feedback = {
  text: string
  tone: 'error' | 'info' | 'success' | 'warning'
}

export function PushPanel() {
  const [branch, setBranch] = useState('main')
  const [preparedBranch, setPreparedBranch] = useState('main')
  const [hasPrepared, setHasPrepared] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [progressMessages, setProgressMessages] = useState<string[]>([])

  const prepareQuery = usePreparePush({
    branch: preparedBranch,
    queryConfig: {enabled: hasPrepared && preparedBranch.trim().length > 0},
  })
  const executeMutation = useExecutePush()

  async function handleExecutePush() {
    const normalizedBranch = branch.trim()
    if (!normalizedBranch) {
      setFeedback({text: 'Enter a branch before pushing.', tone: 'warning'})
      return
    }

    setProgressMessages([])
    setFeedback({text: 'Push started…', tone: 'info'})

    const {apiClient} = useTransportStore.getState()
    const unsubscribe = apiClient?.on<PushProgressEvent>(PushEvents.PROGRESS, (data) => {
      setProgressMessages((current) => [...current, data.message])
    })

    try {
      const result = await executeMutation.mutateAsync({branch: normalizedBranch})
      setFeedback({
        text: `Push completed. ${prepareQuery.data?.summary ?? 'Changes synced'} · View: ${result.url}`,
        tone: 'success',
      })
    } catch (pushError) {
      setFeedback({
        text: pushError instanceof Error ? pushError.message : 'Push failed',
        tone: 'error',
      })
    } finally {
      unsubscribe?.()
    }
  }

  return (
    <Card className="shadow-sm ring-border/70" size="sm">
      <CardHeader>
        <div>
          <CardTitle className="font-semibold">Push context tree</CardTitle>
          <CardDescription>Prepare first, then execute with live progress from `push:progress`.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-muted-foreground" htmlFor="push-branch">
            Branch
          </label>
          <Input
            className="h-10 rounded-lg bg-background px-3"
            id="push-branch"
            onChange={(event) => setBranch(event.target.value)}
            placeholder="main"
            value={branch}
          />
        </div>

        <div className="flex flex-wrap gap-2.5">
          <Button
            className="cursor-pointer inline-flex items-center justify-center gap-2 h-10 px-4 border border-border bg-card text-foreground text-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md"
            onClick={() => {
              setPreparedBranch(branch.trim() || 'main')
              setHasPrepared(true)
              setFeedback(null)
            }}
          >
            Check changes
          </Button>
          <Button
            className="cursor-pointer inline-flex items-center justify-center gap-2 h-10 px-4 border border-primary/30 bg-primary text-foreground text-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md"
            disabled={!prepareQuery.data?.hasChanges || executeMutation.isPending}
            onClick={handleExecutePush}
          >
            {executeMutation.isPending ? 'Pushing…' : 'Execute push'}
          </Button>
        </div>

        {prepareQuery.isLoading ? <div className="p-4 border border-blue-500/20 rounded-xl bg-blue-50 text-blue-700">Checking for context changes…</div> : null}
        {prepareQuery.error ? <div className="p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive">{prepareQuery.error.message}</div> : null}

        {prepareQuery.data ? (
          prepareQuery.data.hasChanges ? (
            <div className="p-4 border border-blue-500/20 rounded-xl bg-blue-50 text-blue-700">
              {prepareQuery.data.summary} · {prepareQuery.data.fileCount} files ready to push
            </div>
          ) : (
            <div className="p-4 border border-yellow-500/20 rounded-xl bg-yellow-50 text-yellow-700">No context changes are ready to push.</div>
          )
        ) : null}

        {feedback ? <div className={feedback.tone === 'error' ? 'p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive' : feedback.tone === 'info' ? 'p-4 border border-blue-500/20 rounded-xl bg-blue-50 text-blue-700' : feedback.tone === 'success' ? 'p-4 border border-primary/20 rounded-xl bg-primary/5 text-primary' : 'p-4 border border-yellow-500/20 rounded-xl bg-yellow-50 text-yellow-700'}>{feedback.text}</div> : null}

        {progressMessages.length > 0 ? (
          <div className="flex flex-col gap-2 mt-3">
            {progressMessages.map((message, index) => (
              <div className="text-muted-foreground text-sm" key={`${message}-${index}`}>
                {message}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
