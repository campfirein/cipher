import type {AgentDTO} from '../../../../shared/transport/types/dto.js'

import {AGENT_CONNECTOR_CONFIG, AGENT_VALUES} from '../../../core/domain/entities/agent.js'

/**
 * Maps all supported agents to their DTO representation.
 * Shared by InitHandler and ConnectorsHandler.
 */
export function mapAgentsToDTOs(): AgentDTO[] {
  return AGENT_VALUES.map((agentName) => {
    const config = AGENT_CONNECTOR_CONFIG[agentName]
    return {
      defaultConnectorType: config.default,
      id: agentName,
      name: agentName,
      supportedConnectorTypes: [...config.supported],
    }
  })
}
