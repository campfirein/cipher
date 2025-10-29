import {Agent} from '../domain/entities/agent.js'

/**
 * Interface for rule writer service operations.
 */
export interface IRuleWriterService {
  /**
   * Writes a rule for the given agent.
   * @param agent The agent for which to write the rule.
   * @param force Whether to force the rule to be written even if it already exists.
   * @returns A promise that resolves when the rule has been written.
   */
  writeRule: (agent: Agent, force: boolean) => Promise<void>
}
