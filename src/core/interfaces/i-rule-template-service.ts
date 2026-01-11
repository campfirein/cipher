import { Agent } from '../domain/entities/agent.js'
import { IntegrationMode } from '../domain/entities/integration-mode.js'

/**
 * Interface for rule template service operations.
 */
export interface IRuleTemplateService {
  /**
   * Generates rule content based on the provided agent and integration mode.
   *
   * @param agent The agent for which to generate the rule content.
   * @param mode The integration mode (cli or mcp). Defaults to 'cli'.
   * @returns Promise resolving to the generated rule content.
   */
  generateRuleContent: (agent: Agent, mode?: IntegrationMode) => Promise<string>
}

