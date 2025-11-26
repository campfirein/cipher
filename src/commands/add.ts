import {confirm, input, search} from '@inquirer/prompts'
import {Args, Command, Flags} from '@oclif/core'
import fs from 'node:fs'
import path from 'node:path'

import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITrackingService} from '../core/interfaces/i-tracking-service.js'

import {CONTEXT_TREE_DOMAINS} from '../config/context-tree-domains.js'
import {getCurrentConfig, isDevelopment} from '../config/environment.js'
import {PROJECT} from '../constants.js'
import {CipherAgent} from '../infra/cipher/cipher-agent.js'
import {ExitCode, exitWithCode} from '../infra/cipher/exit-codes.js'
import {WorkspaceNotInitializedError} from '../infra/cipher/validation/workspace-validator.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {addErrorPrefix} from '../utils/emoji-helpers.js'
import {formatToolCall, formatToolResult} from '../utils/tool-display-formatter.js'

// Constants
const CONTEXT_TREE_PATH = '.brv/context-tree'

// Validation
const validateContent = (content: string): boolean => content.trim().length > 0

export default class Add extends Command {
  public static args = {
    content: Args.string({
      description: 'Content to add to the context tree (triggers autonomous mode)',
      required: false,
    }),
  }
  public static description = 'Add content to the context tree (interactive or autonomous mode)'
  public static examples = [
    '# Interactive mode (manually choose domain/topic)',
    '<%= config.bin %> <%= command.id %>',
    '',
    '# Autonomous mode with internal LLM (default)',
    '<%= config.bin %> <%= command.id %> "User authentication uses JWT tokens with 24h expiry"',
    '',
    ...(isDevelopment()
      ? [
          '# Autonomous mode with OpenRouter (development only)',
          '<%= config.bin %> <%= command.id %> -k YOUR_API_KEY "React components follow atomic design pattern"',
          '',
          '# Autonomous mode with custom model (development only)',
          '<%= config.bin %> <%= command.id %> -k YOUR_API_KEY -m anthropic/claude-sonnet-4 "API rate limit is 100 req/min"',
        ]
      : []),
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
   * Generate a unique session ID for the autonomous agent
   */
  protected generateSessionId(): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    return `${timestamp}-${random}`
  }

  /**
   * Get existing domains from the context tree
   */
  protected getExistingDomains(): string[] {
    try {
      if (!fs.existsSync(CONTEXT_TREE_PATH)) {
        return []
      }

      const entries = fs.readdirSync(CONTEXT_TREE_PATH, {withFileTypes: true})
      return entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return []
    }
  }

  /**
   * Get existing topics for a domain
   */
  protected getExistingTopics(domain: string): string[] {
    try {
      const domainPath = path.join(CONTEXT_TREE_PATH, domain)
      if (!fs.existsSync(domainPath)) {
        return []
      }

      const entries = fs.readdirSync(domainPath, {withFileTypes: true})
      return entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return []
    }
  }

  /**
   * Prompt user to confirm adding content
   */
  protected async promptForConfirmation(domain: string, topic: string, content: string): Promise<boolean> {
    this.log('\nReview your content:')
    this.log(`  Domain: ${domain}`)
    this.log(`  Topic: ${topic}`)

    const contentDisplay = content.length > 200 ? `${content.slice(0, 200)}...` : content
    this.log(`  Content: ${contentDisplay}`)

    const confirmed = await confirm({
      default: true,
      message: 'Add this content to the context tree?',
    })

    return confirmed
  }

  /**
   * Prompt user to enter content
   */
  protected async promptForContent(prefilled?: string): Promise<string> {
    const message = 'Enter content to add to the context tree:'

    const content = await input({
      default: prefilled,
      message,
      validate(value) {
        if (!validateContent(value)) {
          return 'Content cannot be empty'
        }

        return true
      },
    })

    return content
  }

  /**
   * Prompt user to select a domain
   */
  protected async promptForDomain(existingDomains: string[]): Promise<string> {
    const allDomains = [...new Set([...CONTEXT_TREE_DOMAINS.map((d) => d.name), ...existingDomains])]

    const domainChoices = allDomains.map((domainName) => {
      const config = CONTEXT_TREE_DOMAINS.find((d) => d.name === domainName)
      return {
        description: config?.description,
        name: domainName,
        value: domainName,
      }
    })

    const domain = await search({
      message: 'Select or type a domain:',
      async source(input) {
        if (!input) {
          return domainChoices
        }

        const filtered = domainChoices.filter(
          (d) =>
            d.name.toLowerCase().includes(input.toLowerCase()) ||
            d.description?.toLowerCase().includes(input.toLowerCase()),
        )

        // Allow creating new domain
        if (filtered.length === 0 || !filtered.some((d) => d.name === input)) {
          filtered.unshift({description: undefined, name: input, value: input})
        }

        return filtered
      },
    })

    return domain
  }

  /**
   * Prompt user to enter topic name
   */
  protected async promptForTopic(domain: string, existingTopics: string[]): Promise<string> {
    const topic = await search({
      message: `Enter topic name for domain "${domain}":`,
      async source(input) {
        if (!input) {
          return existingTopics.map((t) => ({name: t, value: t}))
        }

        const filtered = existingTopics.filter((t) => t.toLowerCase().includes(input.toLowerCase()))

        // Allow creating new topic
        if (filtered.length === 0 || !filtered.includes(input)) {
          filtered.unshift(input)
        }

        return filtered.map((t) => ({name: t, value: t}))
      },
    })

    return topic
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Add)

    // Determine mode: autonomous if content is provided via args
    const contentInput = args.content

    // Autonomous mode: use CipherAgent to process content
    // Interactive mode: manually prompt for domain/topic/content
    return contentInput ? this.runAutonomous(contentInput, flags) : this.runInteractive()
  }

  /**
   * Write content to context tree manually
   */
  protected async writeToContextTree(domain: string, topic: string, content: string): Promise<void> {
    const topicPath = path.join(CONTEXT_TREE_PATH, domain, topic)
    const contextFilePath = path.join(topicPath, 'context.md')

    // Create directories if they don't exist
    fs.mkdirSync(topicPath, {recursive: true})

    // Append or create context file
    const timestamp = new Date().toISOString()
    const entry = `\n## Added on ${timestamp}\n\n${content}\n`

    if (fs.existsSync(contextFilePath)) {
      fs.appendFileSync(contextFilePath, entry, 'utf8')
    } else {
      fs.writeFileSync(contextFilePath, `# ${topic}\n${entry}`, 'utf8')
    }

    this.log(`\n✓ Content added successfully to ${domain}/${topic}`)
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
      'After initialization, you can run add again.',
    ].join('\n')

    exitWithCode(ExitCode.VALIDATION_ERROR, message)
  }

  /**
   * Run in autonomous mode using CipherAgent
   */
  private async runAutonomous(
    content: string,
    flags: {
      apiKey?: string
      model?: string
      verbose?: boolean
    },
  ): Promise<void> {
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
        teamId: brvConfig?.teamId ?? '',
        temperature: 0.7,
        verbose: flags.verbose ?? false,
      }

      // Create and start CipherAgent
      const agent = new CipherAgent(llmConfig, brvConfig)

      this.log('Starting autonomous context tree curation...')
      await agent.start()

      try {
        const sessionId = this.generateSessionId()

        // Setup event listeners
        this.setupEventListeners(agent, flags.verbose ?? false)

        // Execute with autonomous mode and add commandType
        const prompt = `Add the following content to the context tree:\n\n${content}`
        const response = await agent.execute(prompt, sessionId, {
          executionContext: {commandType: 'add'},
          mode: 'autonomous',
        })

        this.log('\nCipherAgent Response:')
        this.log(response)

        await trackingService.track('ace:add_bullet')
      } finally {
        // await agent.stop()
      }
    } catch (error) {
      if (error instanceof WorkspaceNotInitializedError) {
        this.handleWorkspaceError(error)
        return
      }

      // Error already logged by eventBus listener, just exit with code
      exitWithCode(ExitCode.RUNTIME_ERROR)
    }
  }

  /**
   * Run in interactive mode with manual prompts
   */
  private async runInteractive(): Promise<void> {
    const {trackingService} = this.createServices()

    try {
      this.log('Press Ctrl+C at any time to cancel\n')

      // Get existing domains and topics
      const existingDomains = this.getExistingDomains()

      // Prompt for domain
      const domain = await this.promptForDomain(existingDomains)

      // Get existing topics for the domain
      const existingTopics = this.getExistingTopics(domain)

      // Prompt for topic
      const topic = await this.promptForTopic(domain, existingTopics)

      // Prompt for content
      const content = await this.promptForContent()

      // Prompt for confirmation
      const confirmed = await this.promptForConfirmation(domain, topic, content)

      if (!confirmed) {
        this.log('\nContent not added. Operation cancelled.')
        return
      }

      // Write to context tree
      await this.writeToContextTree(domain, topic, content)

      await trackingService.track('ace:add_bullet')
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Unexpected error occurred')
    }
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
        this.log(addErrorPrefix(payload.error))
      })
    }
  }
}
