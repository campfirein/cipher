import {Args, Command, Flags} from '@oclif/core'

import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITrackingService} from '../core/interfaces/i-tracking-service.js'

import {getCurrentConfig, isDevelopment} from '../config/environment.js'
import {PROJECT} from '../constants.js'
import {CipherAgent} from '../infra/cipher/cipher-agent.js'
import {ExitCode, exitWithCode} from '../infra/cipher/exit-codes.js'
import {WorkspaceNotInitializedError} from '../infra/cipher/validation/workspace-validator.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {formatToolCall, formatToolResult} from '../utils/tool-display-formatter.js'

export default class Query extends Command {
  public static args = {
    query: Args.string({
      description: 'Query terms to search in the context tree',
      required: true,
    }),
  }
  public static description = 'Query and retrieve information from the context tree'
  public static examples = [
    '# Query with internal LLM (default)',
    '<%= config.bin %> <%= command.id %> What are the coding standards?',
    '<%= config.bin %> <%= command.id %> How is authentication implemented?',
    '',
    ...(isDevelopment()
      ? [
          '# Query with OpenRouter (development only)',
          '<%= config.bin %> <%= command.id %> -k YOUR_API_KEY Show me all API endpoints',
          '',
          '# Query with custom model (development only)',
          '<%= config.bin %> <%= command.id %> -k YOUR_API_KEY -m anthropic/claude-sonnet-4 Explain the database schema',
          '',
        ]
      : []),
    '# Query with verbose output',
    '<%= config.bin %> <%= command.id %> -v What testing strategies are used?',
  ]
  public static flags = {
    ...(isDevelopment()
      ? {
          apiKey: Flags.string({
            char: 'k',
            description: 'OpenRouter API key (use OpenRouter instead of internal gRPC backend) [Development only]',
            env: 'OPENROUTER_API_KEY',
          }),
          model: Flags.string({
            char: 'm',
            description:
              'Model to use (default: anthropic/claude-haiku-4.5 for OpenRouter, claude-haiku-4-5@20251001 for gRPC) [Development only]',
          }),
        }
      : {}),
    verbose: Flags.boolean({
      char: 'v',
      default: false,
      description: 'Enable verbose debug output',
    }),
  }
  public static strict = false

  protected createServices(): {
    projectConfigStore: IProjectConfigStore
    trackingService: ITrackingService
  } {
    return {
      projectConfigStore: new ProjectConfigStore(),
      trackingService: new MixpanelTrackingService(new KeychainTokenStore()),
    }
  }

  /**
   * Generate a unique session ID for the query agent
   */
  protected generateSessionId(): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    return `${timestamp}-${random}`
  }

  public async run(): Promise<void> {
    const {argv, flags} = await this.parse(Query)

    const {projectConfigStore, trackingService} = this.createServices()

    try {
      // Get authentication token
      const tokenStore = new KeychainTokenStore()
      const token = await tokenStore.load()
      if (!token) {
        exitWithCode(ExitCode.CONFIG_ERROR, 'Authentication required. Please run "brv login" first.')
      }

      // Load project config
      const brvConfig = await projectConfigStore.read()

      // Create LLM config
      const model = flags.model ?? (flags.apiKey ? 'anthropic/claude-haiku-4.5' : 'claude-haiku-4-5@20251001') // change it to claude-haiku-4-5@20251001 | gemini-2.5-flash for internal llm service model
      const envConfig = getCurrentConfig()

      const llmConfig = {
        accessToken: token.accessToken,
        fileSystemConfig: {workingDirectory: process.cwd()},
        grpcEndpoint: envConfig.llmGrpcEndpoint,
        maxIterations: 10,
        maxTokens: 8192,
        model,
        openRouterApiKey: flags.apiKey,
        projectId: PROJECT,
        sessionKey: token.sessionKey,
        temperature: 0.7,
        verbose: flags.verbose ?? false,
      }

      // Create and start CipherAgent
      const agent = new CipherAgent(llmConfig, brvConfig)

      this.log('Querying context tree...')
      await agent.start()

      try {
        const sessionId = this.generateSessionId()

        // Setup event listeners
        this.setupEventListeners(agent, flags.verbose ?? false)

        // Combine all query terms from argv (everything after flags)
        const queryTerms = argv.join(' ')

        // Execute with autonomous mode and query commandType
        const prompt = `Search the context tree for: ${queryTerms}`
        const response = await agent.execute(prompt, sessionId, {
          executionContext: {commandType: 'query'},
          mode: 'autonomous',
        })

        this.log('\nQuery Results:')
        this.log(response)

        await trackingService.track('ace:query')
      } finally {
        await agent.stop()
      }
    } catch (error) {
      if (error instanceof WorkspaceNotInitializedError) {
        this.handleWorkspaceError(error)
        return
      }

      exitWithCode(ExitCode.RUNTIME_ERROR, `Failed to query context tree: ${(error as Error).message}`)
    }
  }

  /**
   * Handle workspace not initialized error
   */
  private handleWorkspaceError(error: WorkspaceNotInitializedError): void {
    const message = [
      '\n⚠️  ByteRover workspace not found!\n',
      "It looks like you haven't initialized ByteRover in this directory yet.",
      'To get started, please run:\n',
      '  $ brv init\n',
      'This will create the necessary workspace structure in:',
      `  ${error.expectedPath}\n`,
      'After initialization, you can run query again.',
    ].join('\n')

    exitWithCode(ExitCode.VALIDATION_ERROR, message)
  }

  /**
   * Setup event listeners for CipherAgent
   */
  private setupEventListeners(agent: CipherAgent, verbose: boolean): void {
    if (!agent.agentEventBus) {
      throw new Error('Agent event bus not initialized')
    }

    const eventBus = agent.agentEventBus

    if (verbose) {
      // Verbose mode: show detailed events
      eventBus.on('llmservice:thinking', () => {
        this.log('🤔 [Event] LLM is thinking...')
      })

      eventBus.on('llmservice:response', (payload) => {
        this.log(`✅ [Event] LLM Response (${payload.provider}/${payload.model})`)
      })

      eventBus.on('llmservice:toolCall', (payload) => {
        const formattedCall = formatToolCall(payload.toolName, payload.args)
        this.log(`🔧 [Event] Tool Call: ${formattedCall}`)
      })

      eventBus.on('llmservice:toolResult', (payload) => {
        const resultSummary = formatToolResult(payload.toolName, payload.success, payload.result, payload.error)

        if (payload.success) {
          this.log(`✓ [Event] Tool Success: ${payload.toolName} → ${resultSummary}`)
        } else {
          this.log(`✗ [Event] Tool Error: ${payload.toolName} → ${resultSummary}`)
        }
      })

      eventBus.on('llmservice:error', (payload) => {
        this.log(`❌ [Event] LLM Error: ${payload.error}`)
      })
    } else {
      // Non-verbose mode: show concise tool progress
      eventBus.on('llmservice:toolCall', (payload) => {
        this.log(`🔧 Using tool: ${payload.toolName}`)
      })

      eventBus.on('llmservice:toolResult', (payload) => {
        if (payload.success) {
          this.log(`✓ ${payload.toolName} completed`)
        } else {
          this.log(`✗ ${payload.toolName} failed: ${payload.error}`)
        }
      })

      eventBus.on('llmservice:error', (payload) => {
        this.log(`❌ Error: ${payload.error}`)
      })
    }
  }
}
