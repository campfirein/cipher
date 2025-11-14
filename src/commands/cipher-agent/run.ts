import {Args, Command, Flags} from '@oclif/core'

import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'

import {CipherAgent} from '../../infra/cipher/cipher-agent.js'
import {startInteractiveLoop} from '../../infra/cipher/interactive-loop.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {formatToolCall, formatToolResult} from '../../utils/tool-display-formatter.js'

export default class CipherAgentRun extends Command {
  static override args = {
    prompt: Args.string({
      description: 'The prompt to send to CipherAgent (optional in interactive mode)',
      required: false,
    }),
  }
  static override description = 'Run CipherAgent in interactive or single-execution mode'
  static override examples = [
    '# Interactive mode (default when TTY is available)',
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --interactive',
    '',
    '# Single execution mode',
    '<%= config.bin %> <%= command.id %> "Analyze the project structure" --no-interactive',
    '<%= config.bin %> <%= command.id %> "Find all TypeScript files" --no-interactive',
    '',
    '# Piped input (automatically uses non-interactive mode)',
    'echo "Analyze the codebase" | <%= config.bin %> <%= command.id %>',
    '',
    '# Specify working directory',
    '<%= config.bin %> <%= command.id %> -w /path/to/project',
    '<%= config.bin %> <%= command.id %> --working-directory ~/myproject',
  ]
  static override flags = {
    apiKey: Flags.string({
      char: 'k',
      description: 'Gemini API key (or set GEMINI_API_KEY env var)',
      env: 'GEMINI_API_KEY',
    }),
    interactive: Flags.boolean({
      allowNo: true,
      char: 'i',
      description: 'Enable interactive mode (auto-detected from TTY if not specified)',
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
    workingDirectory: Flags.string({
      char: 'w',
      description: 'Working directory for file operations (default: current directory)',
    }),
  }

  protected createServices(): {
    projectConfigStore: IProjectConfigStore
  } {
    return {
      projectConfigStore: new ProjectConfigStore(),
    }
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(CipherAgentRun)

    try {
      if (!flags.apiKey) {
        this.error('API key is required. Set GEMINI_API_KEY environment variable or use --apiKey flag.')
      }

      // Determine interactive mode
      // Priority: explicit flag > TTY detection
      const isInteractive: boolean =
        flags.interactive === undefined
          ? process.stdin.isTTY === true // Auto-detect from TTY
          : flags.interactive // User explicitly set --interactive or --no-interactive

      // Validate prompt requirement for non-interactive mode
      if (!isInteractive && !args.prompt) {
        this.error('Prompt is required in non-interactive mode. Use --interactive flag for interactive mode.')
      }

      // Load ByteRover config to get custom system prompt (if configured)
      const {projectConfigStore} = this.createServices()
      const brvConfig = await projectConfigStore.read()

      // Create LLM configuration (hardcoded defaults + flag overrides)
      const model = flags.model ?? 'gemini-2.5-flash'
      const llmConfig = {
        apiKey: flags.apiKey,
        fileSystemConfig: flags.workingDirectory
          ? {workingDirectory: flags.workingDirectory}
          : undefined,
        maxIterations: 50, // Hardcoded default
        maxTokens: flags.maxTokens ?? 8192, // Default: 8192
        model,
        temperature: flags.temperature ? Number.parseFloat(flags.temperature) : 0.7, // Default: 0.7
      }

      // Create CipherAgent with service factory pattern
      const agent = new CipherAgent(llmConfig, brvConfig)

      this.log('Starting CipherAgent...')
      await agent.start()

      // Setup event listeners for debugging/monitoring
      agent.agentEventBus.on('llmservice:thinking', () => {
        this.log('🤔 [Event] LLM is thinking...')
      })

      agent.agentEventBus.on('llmservice:response', (payload) => {
        this.log(`✅ [Event] LLM Response (${payload.provider}/${payload.model})`)
      })

      agent.agentEventBus.on('llmservice:toolCall', (payload) => {
        const formattedCall = formatToolCall(payload.toolName, payload.args)
        this.log(`🔧 [Event] Tool Call: ${formattedCall}`)
      })

      agent.agentEventBus.on('llmservice:toolResult', (payload) => {
        const resultSummary = formatToolResult(payload.toolName, payload.success, payload.result, payload.error)
        if (payload.success) {
          this.log(`✓ [Event] Tool Success: ${payload.toolName} → ${resultSummary}`)
        } else {
          this.log(`✗ [Event] Tool Error: ${payload.toolName} → ${resultSummary}`)
        }
      })

      agent.agentEventBus.on('llmservice:error', (payload) => {
        this.log(`❌ [Event] LLM Error: ${payload.error}`)
      })

      agent.agentEventBus.on('cipher:conversationReset', () => {
        this.log('🔄 [Event] Conversation Reset')
      })

      if (isInteractive) {
        // Interactive mode: start the loop
        await startInteractiveLoop(agent, {
          model,
          sessionId: 'cipher-agent-session',
        })
      } else {
        // Non-interactive mode: single execution
        this.log('Executing prompt...')
        const response = await agent.execute(args.prompt!)

        this.log('\nCipherAgent Response:')
        this.log(response)

        // Show agent state
        const state = agent.getState()
        this.log(`\n[Agent State: ${state.currentIteration} iterations]`)
      }
    } catch (error) {
      this.error(`Failed to execute CipherAgent: ${(error as Error).message}`)
    }
  }
}
