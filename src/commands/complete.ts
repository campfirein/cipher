import {Args, Command, Flags} from '@oclif/core'
import {basename} from 'node:path'

import type {DeltaBatchJson} from '../core/domain/entities/delta-batch.js'
import type {ReflectorOutputJson} from '../core/domain/entities/reflector-output.js'
import type {IAcePromptBuilder} from '../core/interfaces/i-ace-prompt-builder.js'
import type {IDeltaStore} from '../core/interfaces/i-delta-store.js'
import type {IExecutorOutputStore} from '../core/interfaces/i-executor-output-store.js'
import type {IPlaybookService} from '../core/interfaces/i-playbook-service.js'
import type {IReflectionStore} from '../core/interfaces/i-reflection-store.js'

import {CuratorOutput} from '../core/domain/entities/curator-output.js'
import {DeltaBatch} from '../core/domain/entities/delta-batch.js'
import {ExecutorOutput} from '../core/domain/entities/executor-output.js'
import {ReflectorOutput} from '../core/domain/entities/reflector-output.js'
import {AcePromptTemplates} from '../infra/ace/ace-prompt-templates.js'
import {FileDeltaStore} from '../infra/ace/file-delta-store.js'
import {FileExecutorOutputStore} from '../infra/ace/file-executor-output-store.js'
import {FilePlaybookStore} from '../infra/ace/file-playbook-store.js'
import {FileReflectionStore} from '../infra/ace/file-reflection-store.js'
import {ExitError} from '../infra/cipher/exit-codes.js'
import {FilePlaybookService} from '../infra/playbook/file-playbook-service.js'

export default class Complete extends Command {
  /* eslint-disable perfectionist/sort-objects */
  public static args = {
    hint: Args.string({
      description: 'Short hint for naming output files (e.g., "user-auth", "bug-fix")',
      required: true,
    }),
    reasoning: Args.string({
      description: 'Detailed reasoning and approach for completing the task',
      required: true,
    }),
    finalAnswer: Args.string({
      description: 'The final answer/solution to the task',
      required: true,
    }),
  }
  /* eslint-enable perfectionist/sort-objects */
  public static description =
    'Complete ACE workflow: save executor output, generate reflection, and update playbook in one command'
  public static examples = [
    String.raw`<%= config.bin %> <%= command.id %> "user-auth" "Implemented OAuth2 flow" "Auth works" --tool-usage "Read:src/auth.ts,Edit:src/auth.ts,Bash:npm test" --feedback "All tests passed"`,
    String.raw`<%= config.bin %> <%= command.id %> "validation-fix" "Analyzed validator" "Fixed bug" --tool-usage "Grep:pattern:\"validate\",Read:src/validator.ts" --bullet-ids "bullet-123" --feedback "Tests passed"`,
    String.raw`<%= config.bin %> <%= command.id %> "auth-update" "Improved error handling" "Better errors" --tool-usage "Edit:src/auth.ts" --feedback "Tests passed" --update-bullet "bullet-5"`,
  ]
  public static flags = {
    'bullet-ids': Flags.string({
      char: 'b',
      default: '',
      description: 'Comma-separated list of playbook bullet IDs referenced',
    }),
    feedback: Flags.string({
      char: 'f',
      description: 'Environment feedback about task execution (e.g., "Tests passed", "Build failed")',
      required: true,
    }),
    'tool-usage': Flags.string({
      char: 't',
      description:
        'Comma-separated list of tool calls with arguments (format: "ToolName:argument", e.g., "Read:src/file.ts,Bash:npm test")',
      required: true,
    }),
    'update-bullet': Flags.string({
      char: 'u',
      description: 'Bullet ID to update with new knowledge (if not provided, adds new bullet)',
    }),
  }

  // Override catch to prevent oclif from logging errors that were already displayed
  public async catch(error: Error & {oclif?: {exit: number}}): Promise<void> {
    // Check if error is ExitError (message already displayed by exitWithCode)
    if (error instanceof ExitError) {
      return
    }

    // Backwards compatibility: also check oclif.exit property
    if (error.oclif?.exit !== undefined) {
      // Error already displayed by exitWithCode, silently exit
      return
    }

    // For other errors, hide stack trace and re-throw to let oclif handle them
    if (error.stack) {
      error.stack = error.message
    }

    throw error
  }

  protected createServices(): {
    deltaStore: IDeltaStore
    executorOutputStore: IExecutorOutputStore
    playbookService: IPlaybookService
    promptBuilder: IAcePromptBuilder
    reflectionStore: IReflectionStore
  } {
    return {
      deltaStore: new FileDeltaStore(),
      executorOutputStore: new FileExecutorOutputStore(),
      playbookService: new FilePlaybookService(),
      promptBuilder: new AcePromptTemplates(),
      reflectionStore: new FileReflectionStore(),
    }
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Complete)

    try {
      const {deltaStore, executorOutputStore, playbookService, promptBuilder, reflectionStore} = this.createServices()

      // Parse comma-separated lists
      const bulletIds = this.parseBulletIds(flags['bullet-ids'])
      const toolUsage = this.parseToolUsage(flags['tool-usage'])

      // Phase 1: Executor
      const saveResult = await this.saveExecutorOutput(executorOutputStore, args, bulletIds, toolUsage)

      // Phase 2: Reflector
      const {reflection, reflectionFilePath, tagsApplied} = await this.generateReflectionAndApplyTags(
        {playbookService, promptBuilder, reflectionStore},
        saveResult.executorOutput,
        flags.feedback,
      )

      // Phase 3: Curator
      const {curatorOutput, deltaFilePath} = await this.generateCurationAndApplyDelta(
        {deltaStore, playbookService, promptBuilder},
        reflection,
        saveResult.executorOutput,
        flags,
      )

      // Display final summary
      this.displayFinalSummary({
        curatorOutput,
        deltaFilePath,
        executorPath: saveResult.filePath,
        hint: args.hint,
        reflectionFilePath,
        tagsApplied,
      })
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to complete ACE workflow')
    }
  }

  /**
   * Displays a formatted summary of the completed ACE workflow.
   * Shows file paths, delta operations breakdown, and success confirmation.
   *
   * @param summary - Summary data containing all workflow outputs
   * @param summary.curatorOutput - The curator output containing delta operations
   * @param summary.deltaFilePath - Path to the saved delta file
   * @param summary.executorPath - Path to the saved executor output file
   * @param summary.hint - The hint used for naming output files
   * @param summary.reflectionFilePath - Path to the saved reflection file
   * @param summary.tagsApplied - Number of tags applied to the playbook
   */
  private displayFinalSummary(summary: {
    curatorOutput: CuratorOutput
    deltaFilePath: string
    executorPath: string
    hint: string
    reflectionFilePath: string
    tagsApplied: number
  }): void {
    const {delta} = summary.curatorOutput
    const operationsByType = delta.getOperationsByType()

    this.log('='.repeat(80))
    this.log('✅ ACE WORKFLOW COMPLETED SUCCESSFULLY!')
    this.log('='.repeat(80))
    this.log('')
    this.log('Summary:')
    this.log(`  Hint: ${summary.hint}`)
    this.log(`  Executor output: ${summary.executorPath}`)
    this.log(`  Reflection: ${summary.reflectionFilePath}`)
    this.log(`  Delta: ${summary.deltaFilePath}`)
    this.log(`  Tags applied: ${summary.tagsApplied}`)
    this.log('')
    this.log('Delta operations:')

    if (delta.isEmpty()) {
      this.log('  - No operations (empty delta batch)')
    } else {
      if (operationsByType.ADD) {
        this.log(`  - ADD: ${operationsByType.ADD.length}`)
      }

      if (operationsByType.UPDATE) {
        this.log(`  - UPDATE: ${operationsByType.UPDATE.length}`)
      }

      if (operationsByType.REMOVE) {
        this.log(`  - REMOVE: ${operationsByType.REMOVE.length}`)
      }

      this.log(`  Total operations: ${delta.getOperationCount()}`)
    }

    this.log('')
    this.log('🎉 Playbook has been updated with new knowledge!')
  }

  /**
   * Extracts file paths from tool usage strings and formats them with project name prefix.
   * Converts tool usage entries like "Read:src/file.ts" to "projectName/src/file.ts".
   * Filters out non-file-like arguments (e.g., "Bash:npm test" is excluded).
   *
   * @param toolUsage - Array of tool usage strings (e.g., ["Read:src/file.ts", "Edit:src/other.ts"])
   * @returns Array of formatted file paths with project name prefix
   */
  private extractFilePaths(toolUsage: string[]): string[] {
    const cwd = process.cwd()
    const projectName = basename(cwd)

    return toolUsage
      .map((usage) => {
        const parts = usage.split(':')
        if (parts.length <= 1) return null

        const filePath = parts[1].trim()

        // Filter out non-file-like paths (must contain / or . to be considered a file path)
        if (!filePath.includes('/') && !filePath.includes('.')) {
          return null
        }

        // Remove leading ./ if present
        const cleanPath = filePath.replace(/^\.\//, '')
        // Combine project name with file path
        const fullPath = `${projectName}/${cleanPath}`

        return fullPath
      })
      .filter(Boolean) as string[]
  }

  /**
   * Phase 3: Generates curation and applies delta operations to the playbook.
   * Creates delta operations (ADD or UPDATE) based on reflection insights and applies them to the playbook.
   *
   * @param services - The service instances
   * @param services.deltaStore - Delta store for persisting deltas
   * @param services.playbookService - Playbook service for applying deltas
   * @param services.promptBuilder - Prompt builder for curation prompts
   * @param reflection - The reflection output from Phase 2
   * @param executorOutput - The executor output from Phase 1
   * @param flags - Command flags containing optional update-bullet ID
   * @returns Object containing curator output and delta file path
   */
  private async generateCurationAndApplyDelta(
    services: {
      deltaStore: IDeltaStore
      playbookService: IPlaybookService
      promptBuilder: IAcePromptBuilder
    },
    reflection: ReflectorOutput,
    executorOutput: ExecutorOutput,
    flags: {'update-bullet'?: string},
  ): Promise<{curatorOutput: CuratorOutput; deltaFilePath: string}> {
    this.log('🎨 Phase 3: Generating curation prompt...')

    // Note: We load playbook temporarily just for validation
    // The actual delta application will be done by playbookService
    const tempStore = new FilePlaybookStore()
    const updatedPlaybook = await tempStore.load()
    if (!updatedPlaybook) {
      this.error('Failed to reload playbook')
    }

    // Generate curation prompt (directly call promptBuilder instead of use case)
    // Note: The prompt is generated but not currently used in this auto-generation flow
    // In a full implementation, this would be sent to an LLM for processing
    // services.promptBuilder.buildCuratorPrompt(reflection, updatedPlaybook, questionContext)

    // Determine operation type based on --update-bullet flag
    const updateBulletId = flags['update-bullet']
    let operationType: 'ADD' | 'UPDATE' = 'ADD'

    // Validate bullet exists if UPDATE mode
    if (updateBulletId) {
      const bullet = updatedPlaybook.getBullet(updateBulletId)
      if (!bullet) {
        this.error(`Bullet with ID "${updateBulletId}" not found in playbook. Cannot update non-existent bullet.`)
      }

      operationType = 'UPDATE'
      this.log(`  ℹ️  Updating existing bullet: ${updateBulletId}`)
    } else {
      this.log('  ℹ️  Adding new bullet to playbook...')
    }

    // Auto-generate curator delta
    const relatedFiles = this.extractFilePaths(executorOutput.toolUsage)
    const curatorJson: DeltaBatchJson = {
      operations: [
        {
          bulletId: updateBulletId,
          content: reflection.keyInsight,
          metadata: {
            relatedFiles,
            tags: ['auto-generated'],
            timestamp: new Date().toISOString(),
          },
          section: 'Lessons Learned',
          type: operationType,
        },
      ],
      reasoning:
        operationType === 'UPDATE'
          ? `Updating bullet ${updateBulletId} with new insight: ${reflection.keyInsight}`
          : `Adding key insight from task: ${reflection.keyInsight}`,
    }

    // Parse and save delta batch using service
    const deltaBatch = DeltaBatch.fromJson(curatorJson)
    const curatorOutput = new CuratorOutput(deltaBatch)
    const deltaFilePath = await services.deltaStore.save(deltaBatch, reflection.hint)

    // Apply delta operations using playbook service
    const {operationsApplied} = await services.playbookService.applyDelta({delta: curatorOutput.delta})

    this.log(`  ✓ Delta saved: ${deltaFilePath}`)
    this.log(`  ✓ Delta operations applied to playbook (${operationsApplied} operations)`)
    this.log('')

    return {curatorOutput, deltaFilePath}
  }

  /**
   * Phase 2: Generates reflection based on executor output and applies tags to the playbook.
   * Auto-generates reflection analysis from feedback and applies bullet tags to relevant playbook sections.
   *
   * @param services - The service instances
   * @param services.playbookService - Playbook service for applying reflection tags
   * @param services.promptBuilder - Prompt builder for reflection prompts
   * @param services.reflectionStore - Reflection store for persisting reflections
   * @param executorOutput - The executor output from Phase 1
   * @param feedback - Environment feedback about task execution (e.g., "Tests passed", "Build failed")
   * @returns Object containing reflection output, file path, and number of tags applied
   */
  private async generateReflectionAndApplyTags(
    services: {
      playbookService: IPlaybookService
      promptBuilder: IAcePromptBuilder
      reflectionStore: IReflectionStore
    },
    executorOutput: ExecutorOutput,
    feedback: string,
  ): Promise<{reflection: ReflectorOutput; reflectionFilePath: string; tagsApplied: number}> {
    this.log('🤔 Phase 2: Generating reflection...')

    // Note: We don't need to load playbook here anymore as applyReflectionTags handles it internally

    // Generate reflection prompt (directly call promptBuilder instead of use case)
    // Note: The prompt is generated but not currently used in this auto-generation flow
    // In a full implementation, this would be sent to an LLM for processing
    // const task = executorOutput.reasoning.split('\n')[0] || 'Task from executor'
    // services.promptBuilder.buildReflectorPrompt(executorOutput, task, feedback, playbook, groundTruth)

    // Auto-generate reflection based on feedback
    this.log('  ℹ️  Auto-generating reflection based on feedback...')
    const reflectionJson: ReflectorOutputJson = {
      bulletTags: [],
      correctApproach: executorOutput.reasoning,
      errorIdentification:
        feedback.toLowerCase().includes('fail') || feedback.toLowerCase().includes('error')
          ? `Issues identified: ${feedback}`
          : 'No critical errors identified',
      hint: executorOutput.hint,
      keyInsight: executorOutput.finalAnswer,
      reasoning: `Analysis: ${feedback}. Approach: ${executorOutput.reasoning}`,
      rootCauseAnalysis:
        feedback.toLowerCase().includes('fail') || feedback.toLowerCase().includes('error')
          ? `Root cause requires investigation: ${feedback}`
          : 'Successful execution without errors',
    }

    // Parse and save reflection using service
    const reflection = ReflectorOutput.fromJson(reflectionJson)
    const reflectionFilePath = await services.reflectionStore.save(reflection)

    // Apply tags to playbook using playbook service
    const {tagsApplied} = await services.playbookService.applyReflectionTags({reflection})

    this.log(`  ✓ Reflection saved: ${reflectionFilePath}`)
    this.log(`  ✓ Tags applied to playbook: ${tagsApplied}`)
    this.log('')

    return {reflection, reflectionFilePath, tagsApplied}
  }

  /**
   * Parses comma-separated bullet IDs string into an array of trimmed IDs.
   * Empty strings and whitespace-only entries are filtered out.
   *
   * @param bulletIdsStr - Comma-separated string of bullet IDs (e.g., "bullet-1, bullet-2")
   * @returns Array of trimmed bullet ID strings (empty array if input is empty string)
   */
  private parseBulletIds(bulletIdsStr: string): string[] {
    return bulletIdsStr
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  }

  /**
   * Parses comma-separated tool usage string into an array of trimmed entries.
   * Empty strings and whitespace-only entries are filtered out.
   *
   * @param toolUsageStr - Comma-separated string of tool usage (e.g., "Read:file.ts, Edit:other.ts")
   * @returns Array of trimmed tool usage strings
   */
  private parseToolUsage(toolUsageStr: string): string[] {
    return toolUsageStr
      .split(',')
      .map((tool) => tool.trim())
      .filter((tool) => tool.length > 0)
  }

  /**
   * Phase 1: Saves executor output to a file.
   * Creates an ExecutorOutput entity from command arguments and persists it using the executor output store service.
   *
   * @param executorOutputStore - The executor output store service
   * @param args - Command arguments
   * @param args.hint - Short hint for naming output files
   * @param args.reasoning - Detailed reasoning and approach for completing the task
   * @param args.finalAnswer - The final answer/solution to the task
   * @param bulletIds - Array of playbook bullet IDs referenced during task execution
   * @param toolUsage - Array of tool usage strings (e.g., ["Read:src/file.ts", "Bash:npm test"])
   * @returns Object containing the executor output entity and file path where it was saved
   */
  private async saveExecutorOutput(
    executorOutputStore: IExecutorOutputStore,
    args: {finalAnswer: string; hint: string; reasoning: string},
    bulletIds: string[],
    toolUsage: string[],
  ): Promise<{executorOutput: ExecutorOutput; filePath: string}> {
    this.log('🚀 Starting ACE workflow...')
    this.log('')
    this.log('📝 Phase 1: Saving executor output...')

    const executorOutput = new ExecutorOutput({
      bulletIds,
      finalAnswer: args.finalAnswer,
      hint: args.hint,
      reasoning: args.reasoning,
      toolUsage,
    })

    // Save executor output using service
    const filePath = await executorOutputStore.save(executorOutput)

    this.log(`  ✓ Executor output saved: ${filePath}`)
    this.log('')

    return {executorOutput, filePath}
  }
}
