export const AgentEvents = {
  CONNECTED: 'agent:connected',
  DISCONNECTED: 'agent:disconnected',
  NEW_SESSION: 'agent:newSession',
  NEW_SESSION_CREATED: 'agent:newSessionCreated',
  RESTART: 'agent:restart',
  RESTARTED: 'agent:restarted',
  RESTARTING: 'agent:restarting',
  STATUS_CHANGED: 'agent:status:changed',
} as const

export interface AgentRestartRequest {
  reason: string
}

export interface AgentRestartResponse {
  success: boolean
}
