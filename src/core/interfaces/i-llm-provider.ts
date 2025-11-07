export type LlmGenerateParams = {
  maxTokens?: number
  model?: string
  prompt: string
  temperature?: number
}

export interface ILlmProvider {
  /**
   * Generate a response from the LLM
   * @param params - Generation parameters including prompt and optional model settings
   * @returns The generated text response
   */
  generate: (params: LlmGenerateParams) => Promise<string>
}
