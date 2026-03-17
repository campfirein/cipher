/**
 * IConsolidationLlm — minimal LLM abstraction for ExperienceConsolidationService.
 *
 * A thin, single-method interface so that the consolidation service remains
 * testable without pulling in the full agent layer. In production, the adapter
 * in agent-process.ts wraps ICipherAgent.executeOnSession to fulfil this contract.
 */
export interface IConsolidationLlm {
  /**
   * Make a single-turn LLM call and return the text response.
   *
   * @param systemPrompt - Instruction context for the model
   * @param userMessage - Content to process
   */
  generate(systemPrompt: string, userMessage: string): Promise<string>
}
