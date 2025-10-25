import {Command, Flags} from '@oclif/core'
import {join} from 'node:path'

import type {DeltaBatchJson} from '../../core/domain/entities/delta-batch.js'

import {ApplyDeltaUseCase} from '../../core/usecases/apply-delta-use-case.js'
import {GenerateCurationUseCase} from '../../core/usecases/generate-curation-use-case.js'
import {LoadPlaybookUseCase} from '../../core/usecases/load-playbook-use-case.js'
import {ParseCuratorOutputUseCase} from '../../core/usecases/parse-curator-output-use-case.js'
import {AcePromptTemplates} from '../../infra/ace/ace-prompt-templates.js'
import {FilePlaybookStore} from '../../infra/ace/file-playbook-store.js'
import {findLatestFile, loadReflectionOutput} from '../../utils/ace-file-helpers.js'

export default class Curator extends Command {
  public static description = 'Transform reflection insights into playbook updates (delta operations)'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --reflection reflection-test-hint-2025-10-25T04-59-00.902Z.json',
    'cat curator-output.json | <%= config.bin %> <%= command.id %>',
  ]
  public static flags = {
    reflection: Flags.string({
      char: 'r',
      description: 'Specific reflection file name to use (instead of latest)',
      required: false,
    }),
  }

  // Protected methods for testability
  protected async findLatestReflectionFile(directory: string): Promise<string> {
    return findLatestFile(directory)
  }

  protected async loadReflectionOutputFile(filePath: string) {
    return loadReflectionOutput(filePath)
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Curator)

    try {
      // Step 1: Load reflection (either specified or latest)
      this.log('📋 Loading reflection...')
      const reflectionsDir = join(process.cwd(), '.br', 'ace', 'reflections')

      let reflectionFile: string
      if (flags.reflection) {
        // Use specified reflection file
        reflectionFile = join(reflectionsDir, flags.reflection)
        this.log(`  Using specified reflection: ${flags.reflection}`)
      } else {
        // Find latest reflection
        reflectionFile = await this.findLatestReflectionFile(reflectionsDir)
        this.log(`  Using latest reflection`)
      }

      const reflection = await this.loadReflectionOutputFile(reflectionFile)
      this.log(`  ✓ Loaded: ${reflectionFile}`)

      // Step 2: Load playbook
      this.log('📚 Loading playbook...')
      const playbookStore = new FilePlaybookStore()
      const loadUseCase = new LoadPlaybookUseCase(playbookStore)
      const loadResult = await loadUseCase.execute()

      if (!loadResult.success) {
        this.error(loadResult.error || 'Failed to load playbook. Run `br init` to initialize.')
      }

      const playbook = loadResult.playbook!
      this.log('  ✓ Playbook loaded')

      // Step 3: Generate curation prompt
      this.log('🎨 Generating curation prompt...')
      const promptBuilder = new AcePromptTemplates()
      const generateUseCase = new GenerateCurationUseCase(promptBuilder)

      const generateResult = await generateUseCase.execute({
        playbook,
        reflection,
      })

      if (!generateResult.success) {
        this.error(generateResult.error || 'Failed to generate curation prompt')
      }

      const curationPrompt = generateResult.prompt!

      // Step 4: Display prompt to agent
      this.log('')
      this.log('='.repeat(80))
      this.log('CURATOR PROMPT FOR AGENT')
      this.log('='.repeat(80))
      this.log('')
      this.log(curationPrompt)
      this.log('')
      this.log('='.repeat(80))
      this.log('')
      this.log('📝 Please analyze the above and provide curator output as JSON.')
      this.log('   The JSON should match the DeltaBatchJson structure.')
      this.log('')
      this.log('   After you provide the JSON, I will:')
      this.log('   1. Save the delta operations to .br/ace/deltas/')
      this.log('   2. Apply operations to the playbook')
      this.log('   3. Show you the summary')
      this.log('')
      this.log('💡 Next: Paste your curator JSON below, or save to a file and')
      this.log('   use `cat curator-output.json | br ace curator`')
      this.log('')

      // Step 5: Wait for agent to provide curator JSON
      const stdinData = await this.readStdin()

      if (!stdinData || stdinData.trim().length === 0) {
        this.log('⚠️  No curator JSON provided via stdin.')
        this.log('   Curator prompt has been displayed above.')
        this.log('   To complete the curation, provide JSON via stdin.')
        return
      }

      // Step 6: Parse and save curator output (with hint from reflection)
      this.log('💾 Parsing curator output...')
      const curatorJson = JSON.parse(stdinData) as DeltaBatchJson
      const parseUseCase = new ParseCuratorOutputUseCase()
      const parseResult = await parseUseCase.execute(curatorJson, reflection.hint)

      if (!parseResult.success) {
        this.error(parseResult.error || 'Failed to parse curator output')
      }

      const curatorOutput = parseResult.curatorOutput!
      const deltaFilePath = parseResult.filePath!
      this.log(`  ✓ Delta operations saved: ${deltaFilePath}`)

      // Step 7: Apply delta operations to playbook
      this.log('⚙️  Applying delta operations to playbook...')
      const applyUseCase = new ApplyDeltaUseCase(playbookStore)
      const applyResult = await applyUseCase.execute(curatorOutput.delta)

      if (!applyResult.success) {
        this.error(applyResult.error || 'Failed to apply delta operations')
      }

      // Step 8: Display summary
      const {delta} = curatorOutput
      const operationsByType = delta.getOperationsByType()

      this.log('')
      this.log('✅ Curation completed successfully!')
      this.log('')
      this.log('Summary:')
      this.log(`  Delta file: ${deltaFilePath}`)
      this.log(`  Total operations: ${delta.getOperationCount()}`)
      this.log('')
      this.log('Operations applied:')

      if (operationsByType.ADD) {
        this.log(`  - ADD: ${operationsByType.ADD.length}`)
      }

      if (operationsByType.UPDATE) {
        this.log(`  - UPDATE: ${operationsByType.UPDATE.length}`)
      }

      if (operationsByType.REMOVE) {
        this.log(`  - REMOVE: ${operationsByType.REMOVE.length}`)
      }

      if (delta.isEmpty()) {
        this.log('  - No operations (empty delta batch)')
      }

      this.log('')
      this.log('Playbook has been updated with the new knowledge!')
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to complete curation workflow')
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
