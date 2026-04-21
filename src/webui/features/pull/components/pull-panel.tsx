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

import type {PullProgressEvent} from '../../../../shared/transport/events'

import {PullEvents} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'
import {useExecutePull} from '../api/execute-pull'
import {usePreparePull} from '../api/prepare-pull'

type Feedback = {
  text: string
  tone: 'error' | 'info' | 'success' | 'warning'
}

export function PullPanel() {
  const [branch, setBranch] = useState('main')
  const [preparedBranch, setPreparedBranch] = useState('main')
  const [hasPrepared, setHasPrepared] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [progressMessages, setProgressMessages] = useState<string[]>([])

  const prepareQuery = usePreparePull({
    branch: preparedBranch,
    queryConfig: {enabled: hasPrepared && preparedBranch.trim().length > 0},
  })
  const executeMutation = useExecutePull()

  async function handleExecutePull() {
    const normalizedBranch = branch.trim()
    if (!normalizedBranch) {
      setFeedback({text: 'Enter a branch before pulling.', tone: 'warning'})
      return
    }

    setProgressMessages([])
    setFeedback({text: 'Pull started…', tone: 'info'})

    const {apiClient} = useTransportStore.getState()
    const unsubscribe = apiClient?.on<PullProgressEvent>(PullEvents.PROGRESS, (data) => {
      setProgressMessages((current) => [...current, data.message])
    })

    try {
      const result = await executeMutation.mutateAsync({branch: normalizedBranch})
      setFeedback({
        text: `Pull completed. Commit ${result.commitSha.slice(0, 7)} · +${result.added} ~${result.edited} -${result.deleted}`,
        tone: 'success',
      })
    } catch (pullError) {
      setFeedback({
        text: pullError instanceof Error ? pullError.message : 'Pull failed',
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
          <CardTitle className="font-semibold">Pull context tree</CardTitle>
          <CardDescription>Checks for local changes before running the pull mutation.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-muted-foreground" htmlFor="pull-branch">
            Branch
          </label>
          <Input
            className="h-10 rounded-lg bg-background px-3"
            id="pull-branch"
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
            Check local state
          </Button>
          <Button
            className="cursor-pointer inline-flex items-center justify-center gap-2 h-10 px-4 border border-primary/30 bg-primary text-foreground text-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md"
            disabled={!prepareQuery.data || prepareQuery.data.hasChanges || executeMutation.isPending}
            onClick={handleExecutePull}
          >
            {executeMutation.isPending ? 'Pulling…' : 'Execute pull'}
          </Button>
        </div>

        {prepareQuery.isLoading ? <div className="p-4 border border-blue-500/20 rounded-xl bg-blue-50 text-blue-700">Checking for local context changes…</div> : null}
        {prepareQuery.error ? <div className="p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive">{prepareQuery.error.message}</div> : null}

        {prepareQuery.data ? (
          prepareQuery.data.hasChanges ? (
            <div className="p-4 border border-yellow-500/20 rounded-xl bg-yellow-50 text-yellow-700">
              Local context changes are present. Push first before pulling from ByteRover memory storage.
            </div>
          ) : (
            <div className="p-4 border border-blue-500/20 rounded-xl bg-blue-50 text-blue-700">{prepareQuery.data.summary || 'Workspace is clean.'}</div>
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
