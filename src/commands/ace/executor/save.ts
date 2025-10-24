import {Args, Command, Flags} from '@oclif/core'

import {ExecutorOutput} from '../../../core/domain/entities/executor-output.js'
import {SaveExecutorOutputUseCase} from '../../../core/usecases/save-executor-output-use-case.js'

export default class ExecutorSave extends Command {
  /* eslint-disable perfectionist/sort-objects */
  public static args = {
    reasoning: Args.string({
      description: 'Reasoning and approach for completing the task',
      required: true,
    }),
    finalAnswer: Args.string({
      description: 'The final answer/solution to the task',
      required: true,
    }),
  }
  /* eslint-enable perfectionist/sort-objects */
  public static description = 'Save executor output after completing a task'
  public static examples = [
    '<%= config.bin %> <%= command.id %> "Used TypeScript strict mode" "Successfully implemented authentication"',
    '<%= config.bin %> <%= command.id %> "Analyzed the codebase" "Fixed the validation bug" --bullet-ids "bullet-123,bullet-456"',
    '<%= config.bin %> <%= command.id %> "Followed clean architecture" "Added search feature" --bullet-ids "bullet-789" --tool-usage "TypeScript,Jest,ESLint"',
  ]
  public static flags = {
    'bullet-ids': Flags.string({
      char: 'b',
      default: '',
      description: 'Comma-separated list of playbook bullet IDs referenced',
    }),
    'tool-usage': Flags.string({
      char: 't',
      default: '',
      description: 'Comma-separated list of tools/technologies used',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ExecutorSave)

    try {
      // Parse comma-separated lists
      const bulletIds = flags['bullet-ids']
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)

      const toolUsage = flags['tool-usage']
        .split(',')
        .map((tool) => tool.trim())
        .filter((tool) => tool.length > 0)

      // Create ExecutorOutput entity (will validate inputs)
      const executorOutput = new ExecutorOutput(args.reasoning, args.finalAnswer, bulletIds, toolUsage)

      // Save using use case
      const saveUseCase = new SaveExecutorOutputUseCase()
      const result = await saveUseCase.execute(executorOutput)

      if (!result.success) {
        this.error(result.error || 'Failed to save executor output')
      }

      // Display success message
      this.log('✓ Executor output saved successfully')
      this.log(`  Saved to: ${result.filePath}`)
      this.log('')
      this.log('Summary:')
      this.log(`  Reasoning: ${args.reasoning.slice(0, 80)}${args.reasoning.length > 80 ? '...' : ''}`)
      this.log(
        `  Final Answer: ${args.finalAnswer.slice(0, 80)}${args.finalAnswer.length > 80 ? '...' : ''}`,
      )
      if (bulletIds.length > 0) {
        this.log(`  Referenced Bullets: ${bulletIds.join(', ')}`)
      }

      if (toolUsage.length > 0) {
        this.log(`  Tools Used: ${toolUsage.join(', ')}`)
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to save executor output')
    }
  }
}
