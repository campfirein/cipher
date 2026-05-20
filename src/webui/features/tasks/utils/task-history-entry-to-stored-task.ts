import type {TaskHistoryEntry} from '../../../../shared/transport/events/task-events'
import type {StoredTask} from '../types/stored-task'

export function taskHistoryEntryToStoredTask(entry: TaskHistoryEntry): StoredTask {
  const base: StoredTask = {
    content: entry.content,
    createdAt: entry.createdAt,
    status: entry.status,
    taskId: entry.taskId,
    type: entry.type,
    ...(entry.files ? {files: entry.files} : {}),
    ...(entry.folderPath ? {folderPath: entry.folderPath} : {}),
    ...(entry.model ? {model: entry.model} : {}),
    ...(entry.projectPath ? {projectPath: entry.projectPath} : {}),
    ...(entry.provider ? {provider: entry.provider} : {}),
    ...(entry.reasoningContents ? {reasoningContents: entry.reasoningContents} : {}),
    ...(entry.responseContent ? {responseContent: entry.responseContent} : {}),
    ...(entry.sessionId ? {sessionId: entry.sessionId} : {}),
    ...(entry.toolCalls ? {toolCalls: entry.toolCalls} : {}),
  }

  switch (entry.status) {
    case 'cancelled': {
      return {
        ...base,
        completedAt: entry.completedAt,
        ...(entry.startedAt ? {startedAt: entry.startedAt} : {}),
      }
    }

    case 'completed': {
      return {
        ...base,
        completedAt: entry.completedAt,
        ...(entry.result ? {result: entry.result} : {}),
        ...(entry.startedAt ? {startedAt: entry.startedAt} : {}),
      }
    }

    case 'created': {
      return base
    }

    case 'error': {
      return {
        ...base,
        completedAt: entry.completedAt,
        error: entry.error,
        ...(entry.startedAt ? {startedAt: entry.startedAt} : {}),
      }
    }

    case 'started': {
      return {...base, startedAt: entry.startedAt}
    }
  }
}
