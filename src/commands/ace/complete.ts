import {Args, Command, Flags} from '@oclif/core'
import {basename} from 'node:path'

import type {DeltaBatchJson} from '../../core/domain/entities/delta-batch.js'
import type {ReflectorOutputJson} from '../../core/domain/entities/reflector-output.js'

import {CuratorOutput} from '../../core/domain/entities/curator-output.js'
import {ExecutorOutput} from '../../core/domain/entities/executor-output.js'
import {ReflectorOutput} from '../../core/domain/entities/reflector-output.js'
import {ApplyDeltaUseCase} from '../../core/usecases/apply-delta-use-case.js'
import {ApplyReflectionTagsUseCase} from '../../core/usecases/apply-reflection-tags-use-case.js'
import {GenerateCurationUseCase} from '../../core/usecases/generate-curation-use-case.js'
import {GenerateReflectionUseCase} from '../../core/usecases/generate-reflection-use-case.js'
import {LoadPlaybookUseCase} from '../../core/usecases/load-playbook-use-case.js'
import {ParseCuratorOutputUseCase} from '../../core/usecases/parse-curator-output-use-case.js'
import {ParseReflectionUseCase} from '../../core/usecases/parse-reflection-use-case.js'
import {SaveExecutorOutputUseCase} from '../../core/usecases/save-executor-output-use-case.js'
import {AcePromptTemplates} from '../../infra/ace/ace-prompt-templates.js'
import {FilePlaybookStore} from '../../infra/ace/file-playbook-store.js'

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


  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Complete)

    try {
      // Parse comma-separated lists
      const bulletIds = this.parseBulletIds(flags['bullet-ids'])
      const toolUsage = this.parseToolUsage(flags['tool-usage'])

      // Phase 1: Executor
      const saveResult = await this.saveExecutorOutput(args, bulletIds, toolUsage)

      // Phase 2: Reflector
      const {reflection, reflectionFilePath, tagsApplied} = await this.generateReflectionAndApplyTags(
        saveResult.executorOutput,
        flags.feedback,
      )

      // Phase 3: Curator
      const {curatorOutput, deltaFilePath} = await this.generateCurationAndApplyDelta(reflection, saveResult.executorOutput, flags)

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
   * @param reflection - The reflection output from Phase 2
   * @param executorOutput - The executor output from Phase 1
   * @param flags - Command flags containing optional update-bullet ID
   * @returns Object containing curator output and delta file path
   */
  private async generateCurationAndApplyDelta(
    reflection: ReflectorOutput,
    executorOutput: ExecutorOutput,
    flags: {'update-bullet'?: string},
  ): Promise<{curatorOutput: CuratorOutput; deltaFilePath: string}> {
    this.log('🎨 Phase 3: Generating curation prompt...')

    // Reload playbook
    const playbookStore = new FilePlaybookStore()
    const loadUseCase = new LoadPlaybookUseCase(playbookStore)
    const reloadResult = await loadUseCase.execute()

    if (!reloadResult.success) {
      this.error(reloadResult.error || 'Failed to reload playbook')
    }

    const updatedPlaybook = reloadResult.playbook!

    // Generate curation prompt
    const promptBuilder = new AcePromptTemplates()
    const generateCurationUseCase = new GenerateCurationUseCase(promptBuilder)
    const curationPromptResult = await generateCurationUseCase.execute({
      playbook: updatedPlaybook,
      reflection,
    })

    if (!curationPromptResult.success) {
      this.error(curationPromptResult.error || 'Failed to generate curation prompt')
    }

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
      reasoning: operationType === 'UPDATE'
        ? `Updating bullet ${updateBulletId} with new insight: ${reflection.keyInsight}`
        : `Adding key insight from task: ${reflection.keyInsight}`,
    }
    const parseCuratorUseCase = new ParseCuratorOutputUseCase()
    const parseCuratorResult = await parseCuratorUseCase.execute(curatorJson, reflection.hint)

    if (!parseCuratorResult.success) {
      this.error(parseCuratorResult.error || 'Failed to parse curator output')
    }

    const curatorOutput = parseCuratorResult.curatorOutput!
    const deltaFilePath = parseCuratorResult.filePath!

    // Apply delta operations
    const applyDeltaUseCase = new ApplyDeltaUseCase(playbookStore)
    const applyDeltaResult = await applyDeltaUseCase.execute(curatorOutput.delta)

    if (!applyDeltaResult.success) {
      this.error(applyDeltaResult.error || 'Failed to apply delta operations')
    }

    this.log(`  ✓ Delta saved: ${deltaFilePath}`)
    this.log(`  ✓ Delta operations applied to playbook`)
    this.log('')

    return {curatorOutput, deltaFilePath}
  }

  /**
   * Phase 2: Generates reflection based on executor output and applies tags to the playbook.
   * Auto-generates reflection analysis from feedback and applies bullet tags to relevant playbook sections.
   *
   * @param executorOutput - The executor output from Phase 1
   * @param feedback - Environment feedback about task execution (e.g., "Tests passed", "Build failed")
   * @returns Object containing reflection output, file path, and number of tags applied
   */
  private async generateReflectionAndApplyTags(
    executorOutput: ExecutorOutput,
    feedback: string,
  ): Promise<{reflection: ReflectorOutput; reflectionFilePath: string; tagsApplied: number}> {
    this.log('🤔 Phase 2: Generating reflection...')

    // Load playbook
    const playbookStore = new FilePlaybookStore()
    const loadUseCase = new LoadPlaybookUseCase(playbookStore)
    const loadResult = await loadUseCase.execute()

    if (!loadResult.success) {
      this.error(loadResult.error || 'Failed to load playbook. Run `br init` to initialize.')
    }

    const playbook = loadResult.playbook!

    // Generate reflection prompt
    const promptBuilder = new AcePromptTemplates()
    const generateReflectionUseCase = new GenerateReflectionUseCase(promptBuilder)
    const task = executorOutput.reasoning.split('\n')[0] || 'Task from executor'

    const reflectionPromptResult = await generateReflectionUseCase.execute({
      executorOutput,
      feedback,
      playbook,
      task,
    })

    if (!reflectionPromptResult.success) {
      this.error(reflectionPromptResult.error || 'Failed to generate reflection prompt')
    }

    // Auto-generate reflection based on feedback
    this.log('  ℹ️  Auto-generating reflection based on feedback...')
    const reflectionJson: ReflectorOutputJson = {
      bulletTags: [],
      correctApproach: executorOutput.reasoning,
      errorIdentification: feedback.toLowerCase().includes('fail') || feedback.toLowerCase().includes('error')
        ? `Issues identified: ${feedback}`
        : 'No critical errors identified',
      hint: executorOutput.hint,
      keyInsight: executorOutput.finalAnswer,
      reasoning: `Analysis: ${feedback}. Approach: ${executorOutput.reasoning}`,
      rootCauseAnalysis: feedback.toLowerCase().includes('fail') || feedback.toLowerCase().includes('error')
        ? `Root cause requires investigation: ${feedback}`
        : 'Successful execution without errors',
    }

    const parseReflectionUseCase = new ParseReflectionUseCase()
    const parseReflectionResult = await parseReflectionUseCase.execute(reflectionJson)

    if (!parseReflectionResult.success) {
      this.error(parseReflectionResult.error || 'Failed to parse reflection')
    }

    const reflection = parseReflectionResult.reflection!
    const reflectionFilePath = parseReflectionResult.filePath!

    // Apply tags to playbook
    const applyTagsUseCase = new ApplyReflectionTagsUseCase(playbookStore)
    const applyTagsResult = await applyTagsUseCase.execute(reflection)

    if (!applyTagsResult.success) {
      this.error(applyTagsResult.error || 'Failed to apply tags to playbook')
    }

    const tagsApplied = applyTagsResult.tagsApplied || 0

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
   * Creates an ExecutorOutput entity from command arguments and persists it using SaveExecutorOutputUseCase.
   *
   * @param args - Command arguments
   * @param args.hint - Short hint for naming output files
   * @param args.reasoning - Detailed reasoning and approach for completing the task
   * @param args.finalAnswer - The final answer/solution to the task
   * @param bulletIds - Array of playbook bullet IDs referenced during task execution
   * @param toolUsage - Array of tool usage strings (e.g., ["Read:src/file.ts", "Bash:npm test"])
   * @returns Object containing the executor output entity and file path where it was saved
   */
  private async saveExecutorOutput(
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

    const saveUseCase = new SaveExecutorOutputUseCase()
    const saveResult = await saveUseCase.execute(executorOutput)

    if (!saveResult.success) {
      this.error(saveResult.error || 'Failed to save executor output')
    }

    this.log(`  ✓ Executor output saved: ${saveResult.filePath}`)
    this.log('')

    return {executorOutput, filePath: saveResult.filePath!}
  }
}
