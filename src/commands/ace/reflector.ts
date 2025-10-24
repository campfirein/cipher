import {Args, Command} from '@oclif/core'
import {join} from 'node:path'

import type {ReflectorOutputJson} from '../../core/domain/entities/reflector-output.js'

import {ApplyReflectionTagsUseCase} from '../../core/usecases/apply-reflection-tags-use-case.js'
import {GenerateReflectionUseCase} from '../../core/usecases/generate-reflection-use-case.js'
import {LoadPlaybookUseCase} from '../../core/usecases/load-playbook-use-case.js'
import {ParseReflectionUseCase} from '../../core/usecases/parse-reflection-use-case.js'
import {AcePromptTemplates} from '../../infra/ace/ace-prompt-templates.js'
import {FilePlaybookStore} from '../../infra/ace/file-playbook-store.js'
import {findLatestFile, loadExecutorOutput} from '../../utils/ace-file-helpers.js'

export default class Reflector extends Command {
  public static args = {
    feedback: Args.string({
      description: 'Environment feedback about executor performance',
      required: true,
    }),
  }
  public static description =
    'Analyze executor output and generate reflection to improve the playbook'
  public static examples = [
    '<%= config.bin %> <%= command.id %> "Tests passed successfully"',
    '<%= config.bin %> <%= command.id %> "3 tests failed: authentication bug detected"',
    '<%= config.bin %> <%= command.id %> "Build successful but missing error handling"',
  ]

  // Protected methods for testability
  protected async findLatestExecutorFile(directory: string): Promise<string> {
    return findLatestFile(directory)
  }

  protected async loadExecutorOutputFile(filePath: string) {
    return loadExecutorOutput(filePath)
  }

  public async run(): Promise<void> {
    const {args} = await this.parse(Reflector)

    try {
      // Step 1: Load latest executor output
      this.log('📋 Loading latest executor output...')
      const executorOutputsDir = join(process.cwd(), '.br', 'ace', 'executor-outputs')
      const latestExecutorFile = await this.findLatestExecutorFile(executorOutputsDir)
      const executorOutput = await this.loadExecutorOutputFile(latestExecutorFile)
      this.log(`  ✓ Loaded: ${latestExecutorFile}`)

      // Step 2: Load playbook
      this.log('📚 Loading playbook...')
      const playbookStore = new FilePlaybookStore()
      const loadUseCase = new LoadPlaybookUseCase(playbookStore)
      const loadResult = await loadUseCase.execute()

      if (!loadResult.success) {
        this.error(loadResult.error || 'Failed to load playbook. Run `br ace init` to initialize.')
      }

      const playbook = loadResult.playbook!
      this.log('  ✓ Playbook loaded')

      // Step 3: Generate reflection prompt
      this.log('🤔 Generating reflection prompt...')
      const promptBuilder = new AcePromptTemplates()
      const generateUseCase = new GenerateReflectionUseCase(promptBuilder)

      // Extract task from executor output reasoning/finalAnswer
      const task = executorOutput.reasoning.split('\n')[0] || 'Task from executor'

      const generateResult = await generateUseCase.execute({
        executorOutput,
        feedback: args.feedback,
        playbook,
        task,
      })

      if (!generateResult.success) {
        this.error(generateResult.error || 'Failed to generate reflection prompt')
      }

      const reflectionPrompt = generateResult.prompt!

      // Step 4: Display prompt to agent
      this.log('')
      this.log('=' .repeat(80))
      this.log('REFLECTION PROMPT FOR AGENT')
      this.log('=' .repeat(80))
      this.log('')
      this.log(reflectionPrompt)
      this.log('')
      this.log('=' .repeat(80))
      this.log('')
      this.log('📝 Please analyze the above and provide your reflection as JSON.')
      this.log('   The JSON should match the ReflectorOutputJson structure.')
      this.log('')
      this.log('   After you provide the JSON, I will:')
      this.log('   1. Save the reflection to .br/ace/reflections/')
      this.log('   2. Apply bullet tags to the playbook')
      this.log('   3. Show you the summary')
      this.log('')
      this.log('💡 Next: Paste your reflection JSON below, or save to a file and')
      this.log(`   use \`cat reflection.json | br ace reflector "${args.feedback}"\``)
      this.log('')

      // Step 5: Wait for agent to provide reflection JSON
      // For now, we'll read from stdin
      const stdinData = await this.readStdin()

      if (!stdinData || stdinData.trim().length === 0) {
        this.log('⚠️  No reflection JSON provided via stdin.')
        this.log('   Reflection prompt has been displayed above.')
        this.log('   To complete the reflection, provide JSON via stdin or create a separate save command.')
        return
      }

      // Step 6: Parse and save reflection
      this.log('💾 Parsing reflection JSON...')
      const reflectionJson = JSON.parse(stdinData) as ReflectorOutputJson
      const parseUseCase = new ParseReflectionUseCase()
      const parseResult = await parseUseCase.execute(reflectionJson)

      if (!parseResult.success) {
        this.error(parseResult.error || 'Failed to parse reflection')
      }

      const reflection = parseResult.reflection!
      const reflectionFilePath = parseResult.filePath!
      this.log(`  ✓ Reflection saved: ${reflectionFilePath}`)

      // Step 7: Apply tags to playbook
      this.log('🏷️  Applying tags to playbook...')
      const applyTagsUseCase = new ApplyReflectionTagsUseCase(playbookStore)
      const applyResult = await applyTagsUseCase.execute(reflection)

      if (!applyResult.success) {
        this.error(applyResult.error || 'Failed to apply tags to playbook')
      }

      const tagsApplied = applyResult.tagsApplied || 0
      this.log(`  ✓ Applied ${tagsApplied} tag(s) to playbook bullets`)

      // Step 8: Display summary
      this.log('')
      this.log('✅ Reflection completed successfully!')
      this.log('')
      this.log('Summary:')
      this.log(`  Reflection file: ${reflectionFilePath}`)
      this.log(`  Tags applied: ${tagsApplied}`)
      this.log(`  Key insight: ${reflection.keyInsight}`)
      this.log('')
      this.log('Next step: Run `br ace curator` to update the playbook')
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to complete reflection workflow')
    }
  }

  /**
   * Reads data from stdin.
   * Returns empty string if no data available.
   */
  private async readStdin(): Promise<string> {
    // Check if stdin is being piped
    if (process.stdin.isTTY) {
      return ''
    }

    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer)
    }

    return Buffer.concat(chunks).toString('utf8')
  }
}
