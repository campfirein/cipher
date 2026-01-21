import {Agent} from '../domain/entities/agent.js'
import {ConnectorType} from '../domain/entities/connector-type.js'

/**
 * Interface for rule template service operations.
 */
export interface IRuleTemplateService {
  /**
   * Generates rule content based on the provided agent and connector type.
   *
   * @param agent The agent for which to generate the rule content.
   * @param type The connector type (rules or mcp). Defaults to 'rules'.
   * @returns Promise resolving to the generated rule content.
   */
  generateRuleContent: (agent: Agent, type: ConnectorType) => Promise<string>
}
