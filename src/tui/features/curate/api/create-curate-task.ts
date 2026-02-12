/**
 * Curate Task API
 *
 * Creates a curate task via transport. The task execution happens on the server,
 * and progress/completion events are received via task:* events.
 */

import {randomUUID} from 'node:crypto'

import {type TaskAckResponse, TaskEvents} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export interface CreateCurateTaskDTO {
  content?: string
  files?: string[]
}

export interface CreateCurateTaskResult {
  taskId: string
}

/**
 * Create a curate task via transport.
 * Returns immediately after task is acknowledged - actual execution is async.
 */
export const createCurateTask = async ({content, files}: CreateCurateTaskDTO): Promise<CreateCurateTaskResult> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) {
    throw new Error('Not connected to server')
  }

  const taskId = randomUUID()

  await apiClient.request<TaskAckResponse>(TaskEvents.CREATE, {
    clientCwd: process.cwd(),
    content: content ?? '',
    ...(files && files.length > 0 ? {files} : {}),
    taskId,
    type: 'curate',
  })

  return {taskId}
}
