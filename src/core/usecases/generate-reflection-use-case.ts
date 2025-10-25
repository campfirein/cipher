import type {ExecutorOutput} from '../domain/entities/executor-output.js'
import type {Playbook} from '../domain/entities/playbook.js'
import type {IAcePromptBuilder, ReflectorPromptParams} from '../interfaces/i-ace-prompt-builder.js'

export interface GenerateReflectionResult {
  error?: string
  prompt?: string
  success: boolean
}

/**
 * Use case for generating reflection prompt for the agent.
 * Takes executor output and environment feedback, returns prompt string.
 */
export class GenerateReflectionUseCase {
  private readonly promptBuilder: IAcePromptBuilder

  public constructor(promptBuilder: IAcePromptBuilder) {
    this.promptBuilder = promptBuilder
  }

  public async execute(params: {
    executorOutput: ExecutorOutput
    feedback: string
    groundTruth?: string
    playbook: Playbook
    task: string
  }): Promise<GenerateReflectionResult> {
    try {
      const {executorOutput, feedback, groundTruth, playbook, task} = params

      // Validate inputs
      if (!task || task.trim().length === 0) {
        return {
          error: 'Task description is required',
          success: false,
        }
      }

      if (!feedback || feedback.trim().length === 0) {
        return {
          error: 'Feedback is required',
          success: false,
        }
      }

      // Build reflector prompt
      const promptParams: ReflectorPromptParams = {
        executorOutput,
        feedback,
        groundTruth,
        playbook,
        task,
      }

      const prompt = this.promptBuilder.buildReflectorPrompt(promptParams)

      return {
        prompt,
        success: true,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to generate reflection prompt',
        success: false,
      }
    }
  }
}
