import {
  AuthEvents,
  type AuthLoginCompletedEvent,
  type AuthStartLoginResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

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
