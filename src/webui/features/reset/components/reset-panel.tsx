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
import {useQueryClient} from '@tanstack/react-query'
import {useState} from 'react'

import {getStatusQueryOptions} from '../../status/api/get-status'
import {useExecuteReset} from '../api/execute-reset'

type Feedback = {
  text: string
  tone: 'error' | 'success'
}

export function ResetPanel() {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const queryClient = useQueryClient()
  const resetMutation = useExecuteReset()

  async function handleReset() {
    try {
      await resetMutation.mutateAsync()
      await queryClient.invalidateQueries({queryKey: getStatusQueryOptions().queryKey})
      setFeedback({text: 'Project reset completed.', tone: 'success'})
      setIsConfirmOpen(false)
    } catch (resetError) {
      setFeedback({
        text: resetError instanceof Error ? resetError.message : 'Reset failed',
        tone: 'error',
      })
    }
  }

  return (
    <>
      <Card className="bg-destructive/5 shadow-sm ring-destructive/20" size="sm">
        <CardHeader>
          <div>
            <CardTitle className="font-semibold">Danger zone</CardTitle>
            <CardDescription>Reset uses the same destructive transport mutation as the TUI reset flow.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {feedback ? <div className={feedback.tone === 'error' ? 'p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive' : 'p-4 border border-primary/20 rounded-xl bg-primary/5 text-primary'}>{feedback.text}</div> : null}

          <div className="flex flex-wrap gap-2.5">
            <Button className="cursor-pointer" onClick={() => setIsConfirmOpen(true)} size="lg" variant="destructive">
              Reset project
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog onOpenChange={(open) => { if (!open) setIsConfirmOpen(false) }} open={isConfirmOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Reset project state?</DialogTitle>
            <DialogDescription>
              This action clears project state through the daemon reset handler. Use it when the local context tree is in a bad state.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button className="cursor-pointer" variant="ghost" />}>
              Cancel
            </DialogClose>
            <Button
              className="cursor-pointer"
              onClick={handleReset}
              size="lg"
              variant="destructive"
            >
              Reset project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
