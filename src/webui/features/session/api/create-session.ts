import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {AgentEvents, type AgentNewSessionRequest, type AgentNewSessionResponse} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export type CreateSessionDTO = {
  reason?: string
}

export const createSession = ({reason}: CreateSessionDTO = {}): Promise<AgentNewSessionResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<AgentNewSessionResponse, AgentNewSessionRequest>(AgentEvents.NEW_SESSION, {reason})
}

export const subscribeToNewSessionCreated = (callback: (data: AgentNewSessionResponse) => void): (() => void) => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return () => {}

  return apiClient.on<AgentNewSessionResponse>(AgentEvents.NEW_SESSION_CREATED, callback)
}

type UseCreateSessionOptions = {
  mutationConfig?: MutationConfig<typeof createSession>
}

export const useCreateSession = ({mutationConfig}: UseCreateSessionOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: createSession,
  })
