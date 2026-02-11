import {
  AgentEvents,
  type AgentRestartRequest,
  type AgentRestartResponse,
  AuthEvents,
  type AuthLoginCompletedEvent,
  type AuthStartLoginResponse,
} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const login = (): Promise<AuthStartLoginResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<AuthStartLoginResponse>(AuthEvents.START_LOGIN)
}

export const subscribeToLoginCompleted = (callback: (data: AuthLoginCompletedEvent) => void): (() => void) => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return () => {}

  return apiClient.on<AuthLoginCompletedEvent>(AuthEvents.LOGIN_COMPLETED, callback)
}

export const restartAgent = (reason: string): Promise<AgentRestartResponse> => {
  const {client} = useTransportStore.getState()
  if (!client) return Promise.reject(new Error('Not connected'))

  return client.requestWithAck<AgentRestartResponse, AgentRestartRequest>(AgentEvents.RESTART, {reason})
}
