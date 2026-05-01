import {useInfiniteQuery} from '@tanstack/react-query'

import {
  TaskEvents,
  type TaskListRequest,
  type TaskListResponse,
} from '../../../../shared/transport/events/task-events'
import {useTransportStore} from '../../../stores/transport-store'

export const DEFAULT_PAGE_LIMIT = 50

export const getTasks = (data?: TaskListRequest): Promise<TaskListResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<TaskListResponse, TaskListRequest>(TaskEvents.LIST, data)
}

export const initialPageParam = (projectPath?: string): TaskListRequest => ({
  limit: DEFAULT_PAGE_LIMIT,
  ...(projectPath ? {projectPath} : {}),
})

export const getNextPageParam = (
  lastPage: TaskListResponse,
  lastParam: TaskListRequest,
): TaskListRequest | undefined => {
  if (lastPage.nextCursor === undefined) return undefined
  return {
    ...lastParam,
    before: lastPage.nextCursor,
    ...(lastPage.nextCursorTaskId ? {beforeTaskId: lastPage.nextCursorTaskId} : {}),
  }
}

type UseGetTasksOptions = {
  projectPath?: string
}

export const useGetTasks = ({projectPath}: UseGetTasksOptions = {}) =>
  useInfiniteQuery({
    getNextPageParam: (lastPage: TaskListResponse, _allPages, lastParam: TaskListRequest) =>
      getNextPageParam(lastPage, lastParam),
    initialPageParam: initialPageParam(projectPath),
    queryFn: ({pageParam}) => getTasks(pageParam),
    queryKey: ['tasks', 'list', projectPath ?? ''],
  })
