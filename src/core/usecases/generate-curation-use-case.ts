import type {Playbook} from '../domain/entities/playbook.js'
import type {ReflectorOutput} from '../domain/entities/reflector-output.js'
import type {IAcePromptBuilder} from '../interfaces/i-ace-prompt-builder.js'

export interface GenerateCurationResult {
  error?: string
  prompt?: string
  success: boolean
}

/**
 * Use case for generating curator prompt for the agent.
 * Takes reflection and playbook, returns prompt for generating delta operations.
 */
export class GenerateCurationUseCase {
  private readonly promptBuilder: IAcePromptBuilder

  public constructor(promptBuilder: IAcePromptBuilder) {
    this.promptBuilder = promptBuilder
  }

  public async execute(params: {
    playbook: Playbook
    questionContext?: string
    reflection: ReflectorOutput
  }): Promise<GenerateCurationResult> {
    try {
      const {playbook, questionContext = '', reflection} = params

      // Build curator prompt
      const prompt = this.promptBuilder.buildCuratorPrompt(reflection, playbook, questionContext)

      return {
        prompt,
        success: true,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to generate curation prompt',
        success: false,
      }
    }
  }
}
