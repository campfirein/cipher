/**
 * Agent-specific error codes.
 */
export enum AgentErrorCode {
  ALREADY_STARTED = 'agent_already_started',
  EXECUTION_FAILED = 'agent_execution_failed',
  INITIALIZATION_FAILED = 'agent_initialization_failed',
  INVALID_CONFIG = 'agent_invalid_config',
  MISSING_REQUIRED_SERVICE = 'agent_missing_required_service',
  NOT_STARTED = 'agent_not_started',
  SERVICE_NOT_INITIALIZED = 'agent_service_not_initialized',
  SESSION_LIMIT_EXCEEDED = 'agent_session_limit_exceeded',
  SESSION_NOT_FOUND = 'agent_session_not_found',
  STOPPED = 'agent_stopped',
}
