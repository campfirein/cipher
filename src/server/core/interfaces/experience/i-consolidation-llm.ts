/**
 * IConsolidationLlm — minimal LLM abstraction for ExperienceConsolidationService.
 *
 * A thin, single-method interface so that the consolidation service remains
 * testable without pulling in the full agent layer. In production, the adapter
 * in agent-process.ts wraps ICipherAgent.executeOnSession to fulfil this contract.
 *
 * Note on `instructions`: the production adapter concatenates `instructions` and
 * `userMessage` into a single user-role message (executeOnSession does not expose
 * a separate system-prompt override channel). The parameter is therefore named
 * `instructions` rather than `systemPrompt` to reflect this adapter-level detail
 * accurately — it carries privileged guidance but is delivered as user content,
 * not as a system directive.
 */
export interface IConsolidationLlm {
  /**
   * Make a single-turn LLM call and return the text response.
   *
   * @param instructions - Consolidation rules / guidance prepended to the user content
   * @param userMessage  - The bullets or content to process
   */
  generate(instructions: string, userMessage: string): Promise<string>
}
