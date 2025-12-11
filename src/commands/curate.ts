import {input} from '@inquirer/prompts'
import {Args, Command, Flags} from '@oclif/core'
import chalk from 'chalk'
import {fileSelector, Item, ItemType} from 'inquirer-file-selector'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import open from 'open'

import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITrackingService} from '../core/interfaces/i-tracking-service.js'

import {CONTEXT_TREE_DOMAINS} from '../config/context-tree-domains.js'
import {getCurrentConfig, isDevelopment} from '../config/environment.js'
import {BRV_DIR, CONTEXT_FILE, CONTEXT_TREE_DIR, PROJECT} from '../constants.js'
import {CipherAgent} from '../infra/cipher/cipher-agent.js'
import {ExitCode, ExitError, exitWithCode} from '../infra/cipher/exit-codes.js'
import {WorkspaceNotInitializedError} from '../infra/cipher/validation/workspace-validator.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {addErrorPrefix} from '../utils/emoji-helpers.js'
import {validateFileForCurate} from '../utils/file-validator.js'
import {formatToolCall, formatToolResult} from '../utils/tool-display-formatter.js'

// Full path to context tree
const CONTEXT_TREE_PATH = path.join(BRV_DIR, CONTEXT_TREE_DIR)

export default class Curate extends Command {
  public static args = {
    context: Args.string({
      description: 'Knowledge context: patterns, decisions, errors, or insights (triggers autonomous mode)',
      required: false,
    }),
  }
  public static description = `Curate context to the context tree (interactive or autonomous mode)
Good:
- "Auth uses JWT with 24h expiry. Tokens stored in httpOnly cookies via authMiddleware.ts"
- "API rate limit is 100 req/min per user. Implemented using Redis with sliding window in rateLimiter.ts"
Bad:
- "Authentication" or "JWT tokens" (too vague, lacks context)
- "Rate limiting" (no implementation details or file references)`
  public static examples = [
    '# Interactive mode (manually choose domain/topic)',
    '<%= config.bin %> <%= command.id %>',
    '',
    '# Autonomous mode - LLM auto-categorizes your context',
    '<%= config.bin %> <%= command.id %> "Auth uses JWT with 24h expiry. Tokens stored in httpOnly cookies via authMiddleware.ts"',
    '',
    '# Include relevant files for comprehensive context (use sparingly, max 5 files)',
    '- NOTE: CONTEXT argument must come BEFORE --files flag',
    '- NOTE: For multiple files, repeat --files (or -f) flag for each file',
    '- NOTE: Only text/code files from current project directory.',
    '',
    '## Single file',
    '<%= config.bin %> <%= command.id %> "Authentication middleware validates JWT tokens and attaches user context" -f src/middleware/auth.ts',
    '',
    '## Multiple files',
    '<%= config.bin %> <%= command.id %> "JWT authentication implementation with refresh token rotation" --files src/auth/jwt.ts --files docs/auth.md',
    '',
    ...(isDevelopment()
      ? [
          '# Autonomous mode with OpenRouter (development only)',
          '<%= config.bin %> <%= command.id %> -k YOUR_API_KEY "React components follow atomic design in src/components/. Atoms in atoms/, molecules in molecules/, organisms in organisms/"',
          '',
          '# Autonomous mode with custom model (development only)',
          '<%= config.bin %> <%= command.id %> -k YOUR_API_KEY -m anthropic/claude-sonnet-4 "API rate limit is 100 req/min per user. Implemented using Redis with sliding window in rateLimiter.ts"',
        ]
      : []),
  ]
  public static flags = {
    files: Flags.string({
      char: 'f',
      description:
        'Include specific file paths for critical context (max 5 files). Only text/code files from the current project directory are allowed. Use sparingly - only for truly relevant files like docs or key implementation details. NOTE: CONTEXT argument must come BEFORE this flag.',
      multiple: true,
    }),
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
              'Model to use (default: google/gemini-2.5-pro for OpenRouter, gemini-2.5-pro for gRPC) [Development only]',
          }),
          verbose: Flags.boolean({
            char: 'v',
            default: false,
            description: 'Enable verbose debug output [Development only]',
          }),
        }
      : {}),
  }

  // Override catch to prevent oclif from logging errors that were already displayed
  async catch(error: Error & {oclif?: {exit: number}}): Promise<void> {
    // Check if error is ExitError (message already displayed by exitWithCode)
    if (error instanceof ExitError) {
      return
    }

    // Backwards compatibility: also check oclif.exit property
    if (error.oclif?.exit !== undefined) {
      return
    }

    // For other errors, re-throw to let oclif handle them
    throw error
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
   * Create topic folder with context.md file
   * @param targetPath - The parent path where the topic folder will be created
   * @param topicName - The name of the topic folder to create
   * @returns The path to the created context.md file
   */
  protected createTopicWithContextFile(targetPath: string, topicName: string): string {
    const topicPath = path.join(targetPath, topicName)
    const contextFilePath = path.join(topicPath, CONTEXT_FILE)

    // Create the topic directory
    fs.mkdirSync(topicPath, {recursive: true})

    // Create the context.md file with initial content
    const initialContent = `# ${topicName}\n\n<!-- Add your context here -->\n`
    fs.writeFileSync(contextFilePath, initialContent, 'utf8')

    return contextFilePath
  }

  /**
   * Generate a unique session ID for the autonomous agent.
   * Uses crypto.randomUUID() for guaranteed uniqueness (122 bits of entropy).
   */
  protected generateSessionId(): string {
    return randomUUID()
  }

  /**
   * Navigate through the context tree using file selector
   * Returns the selected path relative to context-tree root
   */
  protected async navigateContextTree(): Promise<null | string> {
    const contextTreePath = path.resolve(process.cwd(), CONTEXT_TREE_PATH)

    // Ensure context tree directory exists
    if (!fs.existsSync(contextTreePath)) {
      fs.mkdirSync(contextTreePath, {recursive: true})
    }

    // Ensure predefined domains exist as directories
    for (const domain of CONTEXT_TREE_DOMAINS) {
      const domainPath = path.join(contextTreePath, domain.name)
      if (!fs.existsSync(domainPath)) {
        fs.mkdirSync(domainPath, {recursive: true})
      }
    }

    while (true) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const selectedItem = await fileSelector({
          allowCancel: true,
          basePath: contextTreePath,
          filter: (item: Readonly<Item>) => item.isDirectory,
          message: 'Target context location:',
          pageSize: 15,
          theme: {
            labels: {
              messages: {
                cancel: 'Selection cancelled.',
                empty: 'No sub-folders. Press Enter to add content here.',
              },
            },
          },
          type: ItemType.Directory,
        })

        // User cancelled
        if (!selectedItem) {
          return null
        }

        // Restrict navigation to stay within the context tree
        const normalizedItemPath = path.resolve(selectedItem.path)
        const isValid = normalizedItemPath.startsWith(contextTreePath)

        if (isValid) {
          // Valid selection - proceed
          return selectedItem.path
        }

        // Invalid selection - retry
        this.log(chalk.red('Invalid selection. Please choose a valid location within the context tree.'))
      } catch {
        // Error occurred
        return null
      }
    }
  }

  /**
   * Open a file in the default editor
   * @param filePath - The path to the file to open
   */
  protected async openFile(filePath: string): Promise<void> {
    await open(filePath)
  }

  /**
   * Process file paths from --files flag
   * @param filePaths - Array of file paths (relative or absolute)
   * @returns Formatted instructions for the agent to read the specified files
   */
  protected processFileReferences(filePaths: string[]): string {
    const MAX_FILES = 5

    if (!filePaths || filePaths.length === 0) {
      return ''
    }

    // Validate max files and truncate if needed
    if (filePaths.length > MAX_FILES) {
      const ignored = filePaths.slice(MAX_FILES)
      this.log(`\n⚠️  Only the first ${MAX_FILES} files will be processed. Ignoring: ${ignored.join(', ')}\n`)
      filePaths = filePaths.slice(0, MAX_FILES)
    }

    // Get project root (current directory with .brv)
    const projectRoot = process.cwd()

    // Validate each file and collect errors
    const validPaths: string[] = []
    const errors: string[] = []

    for (const filePath of filePaths) {
      const result = validateFileForCurate(filePath, projectRoot)

      if (result.valid && result.normalizedPath) {
        validPaths.push(result.normalizedPath)
      } else {
        errors.push(`  ✗ ${result.error}`)
      }
    }

    // If there are any validation errors, show them and exit
    if (errors.length > 0) {
      this.log('\n❌ File validation failed:\n')
      this.log(errors.join('\n'))
      this.log('')
      exitWithCode(ExitCode.VALIDATION_ERROR, 'Invalid files provided. Please fix the errors above and try again.')
    }

    // Format instructions for the agent
    const instructions = [
      '\n## IMPORTANT: Critical Files to Read (--files flag)',
      '',
      'The user has explicitly specified these files as critical context that MUST be read before creating knowledge topics:',
      '',
      ...validPaths.map((p) => `- ${p}`),
      '',
      '**MANDATORY INSTRUCTIONS:**',
      '- You MUST use the `read_file` tool to read ALL of these files IN PARALLEL (in a single iteration) before proceeding to create knowledge topics',
      '- These files contain essential context that will help you create comprehensive and accurate knowledge topics',
      '- Read them in parallel to maximize efficiency - they do not depend on each other',
      '- After reading all files, proceed with the normal workflow: detect domains, find existing knowledge, and create/update topics',
      '',
    ]

    return instructions.join('\n')
  }

  /**
   * Prompt user to enter topic name with validation
   * @param targetPath - The path where the topic folder will be created
   * @returns The topic name or null if cancelled
   */
  protected async promptForTopicName(targetPath: string): Promise<null | string> {
    try {
      const topicName = await input({
        message: 'New topic name:',
        validate: (value) => this.validateTopicName(value, targetPath),
      })

      return topicName.trim()
    } catch {
      return null
    }
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Curate)

    // Determine mode: autonomous if context is provided via args
    const contextInput = args.context

    // Autonomous mode: use CipherAgent to process context
    // Interactive mode: manually prompt for domain/topic/context
    return contextInput ? this.runAutonomous(contextInput, flags) : this.runInteractive()
  }

  /**
   * Handle workspace not initialized error
   */
  private handleWorkspaceError(_error: WorkspaceNotInitializedError): void {
    const message = 'Project not initialized. Please run "brv init" to select your team and workspace.'

    exitWithCode(ExitCode.VALIDATION_ERROR, message)
  }

  /**
   * Run in autonomous mode using CipherAgent
   */
  private async runAutonomous(
    content: string,
    flags: {
      apiKey?: string
      files?: string[]
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

      // Validate workspace is initialized
      if (!brvConfig) {
        throw new WorkspaceNotInitializedError(
          'Project not initialized. Please run "brv init" to select your team and workspace.',
          '.brv',
        )
      }

      // Create LLM config
      const model = flags.model ?? (flags.apiKey ? 'google/gemini-2.5-pro' : 'gemini-2.5-pro')
      const envConfig = getCurrentConfig()

      const llmConfig = {
        accessToken: token.accessToken,
        apiBaseUrl: envConfig.llmApiBaseUrl,
        fileSystemConfig: {workingDirectory: process.cwd()},
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

        // Process file references if provided
        const fileReferenceInstructions = flags.files
          ? this.processFileReferences(flags.files)
          : ''

        // Execute with autonomous mode and add commandType
        const prompt = `Add the following context to the context tree:\n\n${content}`
        const response = await agent.execute(prompt, sessionId, {
          executionContext: {commandType: 'curate', fileReferenceInstructions},
          mode: 'autonomous',
        })

        this.log('\nCipherAgent Response:')
        this.log(response)

        await trackingService.track('mem:curate')
      } finally {
        // console.log('Logic for agent stopping and resource cleanup may go here!')
      }
    } catch (error) {
      if (error instanceof WorkspaceNotInitializedError) {
        this.handleWorkspaceError(error)
        return
      }

      // Throw error to let oclif handle exit code
      this.error(error instanceof Error ? error.message : 'Runtime error occurred', {exit: ExitCode.RUNTIME_ERROR})
    }
  }

  /**
   * Run in interactive mode with manual prompts
   */
  private async runInteractive(): Promise<void> {
    const {trackingService} = this.createServices()
    try {
      // Navigate to target location in context tree
      const targetPath = await this.navigateContextTree()

      if (!targetPath) {
        this.log('\nOperation cancelled.')
        return
      }

      // Prompt for topic name with validation
      const topicName = await this.promptForTopicName(targetPath)

      if (!topicName) {
        this.log('\nOperation cancelled.')
        return
      }

      // Create the topic folder with context.md
      const contextFilePath = this.createTopicWithContextFile(targetPath, topicName)
      this.log(`\nCreated: ${contextFilePath}`)

      // Track the event
      trackingService.track('mem:curate')

      // Auto-open context.md in default editor
      this.log('Opening context.md for editing...')
      await this.openFile(contextFilePath)
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
        this.log(`🔧 ${payload.toolName} → Executing...`)
      })

      eventBus.on('llmservice:toolResult', (payload) => {
        if (payload.success) {
          this.log(`✅ ${payload.toolName} → Complete`)
        } else {
          this.log(`❌ ${payload.toolName} → Failed: ${payload.error ?? 'Unknown error'}`)
        }
      })

      eventBus.on('llmservice:error', (payload) => {
        this.log(addErrorPrefix(payload.error))
      })
    }
  }

  private validateTopicName(value: string, targetPath: string): boolean | string {
    const trimmed = value.trim()
    if (!trimmed) {
      return 'Topic name cannot be empty'
    }

    // Check for invalid characters in folder names (filesystem restrictions)
    if (/[/\0]/.test(trimmed)) {
      return 'Topic name cannot contain "/" or null characters'
    }

    // Check if folder already exists
    const topicPath = path.join(targetPath, trimmed)
    if (fs.existsSync(topicPath)) {
      return `Topic "${trimmed}" already exists at this location`
    }

    return true
  }
}
