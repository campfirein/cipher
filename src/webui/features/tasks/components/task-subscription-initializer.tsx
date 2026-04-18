import {useEffect, useRef} from 'react'

import {useTransportStore} from '../../../stores/transport-store'
import {useGetTasks} from '../api/get-tasks'
import {useTaskSubscriptions} from '../hooks/use-task-subscriptions'
import {useTaskStore} from '../stores/task-store'

/**
 * Mounts task lifecycle subscriptions and reconciles the daemon snapshot with
 * the locally-cached tasks. Mounted at the route root so the Tasks tab badge
 * stays accurate regardless of which tab is active.
 *
 * Snapshot policy: merge, don't replace. The daemon discards completed tasks
 * after a 5s grace window, so its `task:list` would otherwise clobber finished
 * tasks the user can still see. Persisted task-store is the source of truth
 * for finished history; the daemon snapshot reconciles in-flight tasks.
 *
 * Project change: clear the cache so a different project starts fresh.
 */
export function TaskSubscriptionInitializer() {
  const projectPath = useTransportStore((s) => s.selectedProject)
  const setTasks = useTaskStore((s) => s.setTasks)
  const mergeTasks = useTaskStore((s) => s.mergeTasks)
  const previousProject = useRef(projectPath)

  useTaskSubscriptions()

  useEffect(() => {
    if (previousProject.current !== projectPath) {
      setTasks([])
      previousProject.current = projectPath
    }
  }, [projectPath, setTasks])

  const {data} = useGetTasks({projectPath: projectPath || undefined})

  useEffect(() => {
    if (!data) return
    mergeTasks(data.tasks)
  }, [data, mergeTasks])

  return null
}
