import {Agent} from '../domain/entities/agent.js'

/**
 * Interface for rule template service operations.
 */
export interface IRuleTemplateService {
  /**
   * Generates rule content based on the provided agent.
   *
   * @param agent The agent for which to generate the rule content.
   * @returns Promise resolving to the generated rule content.
   */
  generateRuleContent: (agent: Agent) => Promise<string>
}
