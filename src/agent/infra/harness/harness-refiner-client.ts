/**
 * AutoHarness V2 — Thin wrapper around the LLM provider for
 * Critic and Refiner completions.
 *
 * The synthesizer depends on `IRefinerClient` (not `ILLMService`
 * directly) so unit tests can stub prompt→response without wiring
 * the full agentic loop.
 */

import type {ILLMService} from '../../core/interfaces/i-llm-service.js'

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IRefinerClient {
  /** Send the Critic prompt and return the analysis string. */
  completeCritic(prompt: string): Promise<string>
  /** Send the Refiner prompt and return the candidate code string. */
  completeRefiner(prompt: string): Promise<string>
  /** The model ID used for refinement (for logging and weak-model checks). */
  readonly modelId: string
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class RefinerClient implements IRefinerClient {
  constructor(
    private readonly llmService: ILLMService,
    public readonly modelId: string,
  ) {}

  async completeCritic(prompt: string): Promise<string> {
    return this.llmService.completeTask(prompt)
  }

  async completeRefiner(prompt: string): Promise<string> {
    return this.llmService.completeTask(prompt)
  }
}
