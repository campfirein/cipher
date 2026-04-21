import {
  AuthEvents,
  type AuthLoginCompletedEvent,
  type AuthStartLoginRequest,
  type AuthStartLoginResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const login = (): Promise<AuthStartLoginResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  // Web UI opens the OAuth URL itself via window.open so the new tab is
  // attributed to a user gesture; tell the daemon to skip its system-browser launch.
  return apiClient.request<AuthStartLoginResponse, AuthStartLoginRequest>(
    AuthEvents.START_LOGIN,
    {skipBrowserLaunch: true},
  )
}

export const subscribeToLoginCompleted = (callback: (data: AuthLoginCompletedEvent) => void): (() => void) => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return () => {}

  return apiClient.on<AuthLoginCompletedEvent>(AuthEvents.LOGIN_COMPLETED, callback)
}
