/**
 * Error thrown when headless mode encounters a prompt that cannot be handled.
 * Provides detailed information about what prompt was required and available choices.
 */
export class HeadlessPromptError extends Error {
  public readonly availableChoices?: string[]
  public readonly code = 'HEADLESS_PROMPT_REQUIRED'
  public readonly promptMessage: string
  public readonly promptType: string

  public constructor(promptType: string, promptMessage: string, availableChoices?: string[]) {
    const choicesInfo = availableChoices?.length ? ` Available choices: ${availableChoices.join(', ')}` : ''
    super(`Headless mode cannot handle ${promptType} prompt: "${promptMessage}".${choicesInfo}`)
    this.name = 'HeadlessPromptError'
    this.promptType = promptType
    this.promptMessage = promptMessage
    this.availableChoices = availableChoices
  }
}
