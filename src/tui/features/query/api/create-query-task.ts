/**
 * Query Task API
 *
 * Creates a query task via transport. The task execution happens on the server,
 * and progress/completion events are received via task:* events.
 */

import {randomUUID} from 'node:crypto'

import {type TaskAckResponse, TaskEvents} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export interface CreateQueryTaskDTO {
  query: string
}

export interface CreateQueryTaskResult {
  taskId: string
}

/**
 * Create a query task via transport.
 * Returns immediately after task is acknowledged - actual execution is async.
 */
export const createQueryTask = async ({query}: CreateQueryTaskDTO): Promise<CreateQueryTaskResult> => {
  const {apiClient, projectPath, worktreeRoot} = useTransportStore.getState()
  if (!apiClient) {
    throw new Error('Not connected to server')
  }

  const taskId = randomUUID()

  await apiClient.request<TaskAckResponse>(TaskEvents.CREATE, {
    clientCwd: process.cwd(),
    content: query,
    ...(projectPath ? {projectPath} : {}),
    taskId,
    type: 'query',
    ...(worktreeRoot ? {worktreeRoot} : {}),
  })

  return {taskId}
}
