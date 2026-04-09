import {
  type WorktreeAddRequest,
  type WorktreeAddResponse,
  WorktreeEvents,
  type WorktreeListResponse,
  type WorktreeRemoveRequest,
  type WorktreeRemoveResponse,
} from '../../../../shared/transport/events/worktree-events.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const addWorktreeViaTransport = (worktreePath: string, force?: boolean): Promise<WorktreeAddResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  const request: WorktreeAddRequest = {force, worktreePath}
  return apiClient.request<WorktreeAddResponse>(WorktreeEvents.ADD, request)
}

export const removeWorktreeViaTransport = (worktreePath?: string): Promise<WorktreeRemoveResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  const request: WorktreeRemoveRequest = {worktreePath}
  return apiClient.request<WorktreeRemoveResponse>(WorktreeEvents.REMOVE, request)
}

export const listWorktreesViaTransport = (): Promise<WorktreeListResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<WorktreeListResponse>(WorktreeEvents.LIST)
}
