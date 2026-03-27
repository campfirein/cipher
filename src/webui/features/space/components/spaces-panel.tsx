import { Badge } from '@campfirein/byterover-packages/components/badge'
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

import type {PullProgressEvent, SpaceDTO} from '../../../../shared/transport/events'

import {PullEvents} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'
import {getAuthStateQueryOptions} from '../../auth/api/get-auth-state'
import {useAuthStore} from '../../auth/stores/auth-store'
import {getStatusQueryOptions} from '../../status/api/get-status'
import {useGetSpaces} from '../api/get-spaces'
import {useSwitchSpace} from '../api/switch-space'

type Feedback = {
  text: string
  tone: 'error' | 'info' | 'success' | 'warning'
}

export function SpacesPanel() {
  const [spaceToSwitch, setSpaceToSwitch] = useState<null | SpaceDTO>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [progressMessages, setProgressMessages] = useState<string[]>([])

  const queryClient = useQueryClient()
  const currentSpaceId = useAuthStore((state) => state.brvConfig?.spaceId)
  const {data, error, isLoading} = useGetSpaces()
  const switchMutation = useSwitchSpace()

  async function handleConfirmSwitch() {
    if (!spaceToSwitch) return

    setProgressMessages([])
    setFeedback({text: `Switching to ${spaceToSwitch.teamName}/${spaceToSwitch.name}…`, tone: 'info'})

    const {apiClient} = useTransportStore.getState()
    const unsubscribe = apiClient?.on<PullProgressEvent>(PullEvents.PROGRESS, (data_) => {
      setProgressMessages((current) => [...current, data_.message])
    })

    try {
      const result = await switchMutation.mutateAsync({spaceId: spaceToSwitch.id})
      if (!result.success) {
        setFeedback({text: result.pullError ?? 'Space switch failed', tone: 'error'})
        return
      }

      useAuthStore.getState().setState({
        brvConfig: result.config,
        isAuthorized: true,
        user: useAuthStore.getState().user,
      })
      await queryClient.invalidateQueries({queryKey: getAuthStateQueryOptions().queryKey})
      await queryClient.invalidateQueries({queryKey: getStatusQueryOptions().queryKey})

      const pullSummary = result.pullResult
        ? `Pulled +${result.pullResult.added} ~${result.pullResult.edited} -${result.pullResult.deleted}`
        : 'No remote context was found for this space.'

      setFeedback({
        text: `Now using ${result.config.teamName}/${result.config.spaceName}. ${pullSummary}`,
        tone: 'success',
      })
      setSpaceToSwitch(null)
    } catch (switchError) {
      setFeedback({
        text: switchError instanceof Error ? switchError.message : 'Space switch failed',
        tone: 'error',
      })
    } finally {
      unsubscribe?.()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="shadow-sm ring-border/70" size="sm">
        <CardHeader>
          <div>
            <CardTitle className="font-semibold">Available spaces</CardTitle>
            <CardDescription>Switching a space also syncs the context tree for the target project.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isLoading ? <div className="p-4 border border-blue-500/20 rounded-xl bg-blue-50 text-blue-700">Loading spaces…</div> : null}
          {error ? <div className="p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive">{error.message}</div> : null}
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

      {(data?.teams ?? []).map((team) => (
        <Card className="shadow-sm ring-border/70" key={team.teamId} size="sm">
          <CardHeader>
            <div>
              <CardTitle className="font-semibold">{team.teamName}</CardTitle>
              <CardDescription>{team.spaces.length} spaces available</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              {team.spaces.map((space) => {
                const isCurrent = currentSpaceId === space.id

                return (
                  <Card className="gap-3 px-4 shadow-none ring-border/80" key={space.id} size="sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <CardTitle className="font-semibold">{space.name}</CardTitle>
                        <CardDescription>
                          {space.isDefault ? 'Default space' : 'Project space'} · {space.teamName}
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap gap-2.5">
                        {isCurrent ? <Badge className="rounded-sm border-transparent bg-primary/10 text-primary" variant="outline">Current</Badge> : null}
                        {isCurrent ? null : (
                          <Button className="cursor-pointer" onClick={() => setSpaceToSwitch(space)} size="lg">
                            Switch
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog onOpenChange={(open) => { if (!open) setSpaceToSwitch(null) }} open={spaceToSwitch !== null}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{spaceToSwitch ? `Switch to ${spaceToSwitch.teamName}/${spaceToSwitch.name}?` : 'Switch space'}</DialogTitle>
            {spaceToSwitch ? (
              <DialogDescription>
                ByteRover will update the active space and then run the same pull-style sync used by the TUI flow.
              </DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button className="cursor-pointer" variant="ghost" />}>
              Cancel
            </DialogClose>
            <Button className="cursor-pointer" onClick={handleConfirmSwitch} size="lg">
              Switch space
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
