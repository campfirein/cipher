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
  folders?: string[]
}

export interface CreateCurateTaskResult {
  taskId: string
}

/**
 * Create a curate task via transport.
 * Returns immediately after task is acknowledged - actual execution is async.
 *
 * When folders are provided, sends as 'curate-folder' task type which
 * triggers the FolderPackExecutor on the server for full directory analysis.
 */
export const createCurateTask = async ({content, files, folders}: CreateCurateTaskDTO): Promise<CreateCurateTaskResult> => {
  const {apiClient, projectRoot} = useTransportStore.getState()
  if (!apiClient) {
    throw new Error('Not connected to server')
  }

  const taskId = randomUUID()
  const hasFolder = Boolean(folders?.length)
  const taskType = hasFolder ? 'curate-folder' : 'curate'

  // Provide default context for folder curation when none is provided
  const resolvedContent = content?.trim()
    ? content
    : hasFolder
      ? 'Analyze this folder and extract all relevant knowledge, patterns, and documentation.'
      : ''

  await apiClient.request<TaskAckResponse>(TaskEvents.CREATE, {
    clientCwd: process.cwd(),
    content: resolvedContent,
    ...(hasFolder && folders ? {folderPath: folders[0]} : {}),
    ...(!hasFolder && files && files.length > 0 ? {files} : {}),
    ...(projectRoot ? {projectPath: projectRoot} : {}),
    taskId,
    type: taskType,
  })

  return {taskId}
}
