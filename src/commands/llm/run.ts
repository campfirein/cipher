import {Args, Command, Flags} from '@oclif/core'

import {FileSystemService} from '../../infra/file-system/file-system-service.js'
import {GeminiLLMService} from '../../infra/llm/gemini-llm-service.js'
import {ToolManager} from '../../infra/tools/tool-manager.js'
import {ToolProvider} from '../../infra/tools/tool-provider.js'

export default class LlmRun extends Command {
  static override args = {
    prompt: Args.string({description: 'The prompt to send to the LLM', required: true}),
  }
  static override description = 'Test the LLM service with a prompt (includes tool calling)'
  static override examples = [
    '<%= config.bin %> <%= command.id %> "What is the capital of France?"',
    '<%= config.bin %> <%= command.id %> "Explain quantum computing" --model gemini-2.0-flash-exp',
  ]
  static override flags = {
    apiKey: Flags.string({
      char: 'k',
      description: 'Gemini API key (or set GEMINI_API_KEY env var)',
      env: 'GEMINI_API_KEY',
    }),
    maxTokens: Flags.integer({
      char: 't',
      description: 'Maximum tokens in response',
    }),
    model: Flags.string({
      char: 'm',
      description: 'Model to use',
    }),
    temperature: Flags.string({
      char: 'T',
      description: 'Temperature for randomness (0-1)',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(LlmRun)

    try {
      if (!flags.apiKey) {
        this.error('API key is required. Set GEMINI_API_KEY environment variable or use --apiKey flag.')
      }

      // Initialize tool system
      const fileSystemService = new FileSystemService()
      const toolProvider = new ToolProvider({fileSystemService})
      await toolProvider.initialize()
      const toolManager = new ToolManager(toolProvider)
      await toolManager.initialize()

      // Create LLM service with config
      const service = new GeminiLLMService(
        'cli-test-session',
        {
          apiKey: flags.apiKey,
          ...(flags.maxTokens && {maxTokens: flags.maxTokens}),
          ...(flags.model && {model: flags.model}),
          ...(flags.temperature && {temperature: Number.parseFloat(flags.temperature)}),
        },
        toolManager,
      )

      this.log('Sending prompt to LLM with tool calling enabled...')
      const response = await service.completeTask(args.prompt, {})

      this.log('\nResponse:')
      this.log(response)
    } catch (error) {
      this.error(`Failed to generate response: ${(error as Error).message}`)
    }
  }
}
