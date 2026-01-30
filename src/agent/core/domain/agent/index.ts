/**
 * Agent Module
 *
 * Exports agent state management types and classes,
 * as well as the multi-agent system components.
 */

// Multi-agent system (agent-info.js)
export {
  AgentInfo,
  AgentInfoSchema,
  AgentMode,
  AgentPermission,
  AgentPermissionSchema,
  DEFAULT_AGENT_PERMISSION,
  PermissionValue,
  READONLY_AGENT_PERMISSION,
} from './agent-info.js'

// Multi-agent system (agent-registry.js)
export {
  AgentName,
  AgentRegistry,
  getAgentRegistry,
  KnownAgent,
} from './agent-registry.js'

// State management
export {AgentStateMachine} from './agent-state-machine.js'
export {AgentExecutionContext, AgentState, TerminationReason} from './agent-state.js'
