import {Args, Command, Flags} from '@oclif/core'

import {CipherAgent} from '../../infra/agents/cipher-agent.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'

export default class CipherAgentRun extends Command {
  static override args = {
    prompt: Args.string({description: 'The prompt to send to CipherAgent', required: true}),
  }
  static override description = 'Run CipherAgent with a prompt'
  static override examples = [
    '<%= config.bin %> <%= command.id %> "Analyze the project structure"',
    '<%= config.bin %> <%= command.id %> "Find all TypeScript files and count lines of code"',
    '<%= config.bin %> <%= command.id %> "Help me refactor the authentication module"',
  ]
  static override flags = {
    apiKey: Flags.string({
      char: 'k',
      description: 'Gemini API key (or set GEMINI_API_KEY env var)',
      env: 'GEMINI_API_KEY',
    }),
    maxTokens: Flags.integer({
      char: 't',
      description: 'Maximum tokens in response (default: 8192)',
    }),
    model: Flags.string({
      char: 'm',
      description: 'Model to use (default: gemini-2.5-flash)',
    }),
    temperature: Flags.string({
      char: 'T',
      description: 'Temperature for randomness 0-1 (default: 0.7)',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(CipherAgentRun)

    try {
      if (!flags.apiKey) {
        this.error('API key is required. Set GEMINI_API_KEY environment variable or use --apiKey flag.')
      }

      // Load ByteRover config to get custom system prompt (if configured)
      const configStore = new ProjectConfigStore()
      const brvConfig = await configStore.read()

      // Create LLM configuration (hardcoded defaults + flag overrides)
      const llmConfig = {
        apiKey: flags.apiKey,
        maxIterations: 50, // Hardcoded default
        maxTokens: flags.maxTokens ?? 8192, // Default: 8192
        model: flags.model ?? 'gemini-2.5-flash', // Default: gemini-2.5-flash
        temperature: flags.temperature ? Number.parseFloat(flags.temperature) : 0.7, // Default: 0.7
      }

      // Create CipherAgent with service factory pattern
      const agent = new CipherAgent(llmConfig, brvConfig)

      this.log('Starting CipherAgent...')
      await agent.start()

      this.log('Executing prompt...')
      const response = await agent.execute(args.prompt)

      this.log('\nCipherAgent Response:')
      this.log(response)

      // Show agent state
      const state = agent.getState()
      this.log(`\n[Agent State: ${state.currentIteration} iterations]`)
    } catch (error) {
      this.error(`Failed to execute CipherAgent: ${(error as Error).message}`)
    }
  }
}
