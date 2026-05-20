import {useQueryClient} from '@tanstack/react-query'
import {useEffect, useRef} from 'react'

import {TaskEvents} from '../../../../shared/transport/events/task-events'
import {useTransportStore} from '../../../stores/transport-store'
import {useTaskSubscriptions} from '../hooks/use-task-subscriptions'
import {useTaskStore} from '../stores/task-store'

const TASK_LIFECYCLE_EVENTS = [
  TaskEvents.CREATED,
  TaskEvents.STARTED,
  TaskEvents.COMPLETED,
  TaskEvents.ERROR,
  TaskEvents.CANCELLED,
  TaskEvents.DELETED,
] as const

export function TaskSubscriptionInitializer() {
  const projectPath = useTransportStore((s) => s.selectedProject)
  const apiClient = useTransportStore((s) => s.apiClient)
  const reset = useTaskStore((s) => s.reset)
  const previousProject = useRef(projectPath)
  const queryClient = useQueryClient()

  useTaskSubscriptions()

  useEffect(() => {
    if (previousProject.current !== projectPath) {
      reset()
      previousProject.current = projectPath
    }
  }, [projectPath, reset])

  useEffect(() => {
    if (!apiClient) return
    const unsubscribers = TASK_LIFECYCLE_EVENTS.map((event) =>
      apiClient.on(event, () => {
        queryClient.invalidateQueries({queryKey: ['tasks', 'list']})
      }),
    )
    return () => {
      for (const unsub of unsubscribers) unsub()
    }
  }, [apiClient, queryClient])

  return null
}
