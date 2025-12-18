import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import open from 'open'

import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {ICipherAgent} from '../../core/interfaces/cipher/i-cipher-agent.js'
import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../core/interfaces/i-tracking-service.js'
import type {
  CurateExecuteOptions,
  CurateTransportCallbacks,
  CurateTransportOptions,
  CurateUseCaseRunOptions,
  ICurateUseCase,
} from '../../core/interfaces/usecase/i-curate-use-case.js'

import {CONTEXT_TREE_DOMAINS} from '../../config/context-tree-domains.js'
import {getCurrentConfig} from '../../config/environment.js'
import {BRV_DIR, CONTEXT_FILE, CONTEXT_TREE_DIR, PROJECT} from '../../constants.js'
import {validateFileForCurate} from '../../utils/file-validator.js'
import {CipherAgent} from '../cipher/cipher-agent.js'
import {getAgentStorage, getAgentStorageSync} from '../cipher/storage/agent-storage.js'
import {WorkspaceNotInitializedError} from '../cipher/validation/workspace-validator.js'

// Full path to context tree
const CONTEXT_TREE_PATH = path.join(BRV_DIR, CONTEXT_TREE_DIR)

export interface CurateUseCaseOptions {
  projectConfigStore: IProjectConfigStore
  terminal: ITerminal
  tokenStore: ITokenStore
  trackingService: ITrackingService
}

export class CurateUseCase implements ICurateUseCase {
  private readonly projectConfigStore: IProjectConfigStore
  private readonly terminal: ITerminal
  private readonly tokenStore: ITokenStore
  private readonly trackingService: ITrackingService

  constructor(options: CurateUseCaseOptions) {
    this.projectConfigStore = options.projectConfigStore
    this.terminal = options.terminal
    this.tokenStore = options.tokenStore
    this.trackingService = options.trackingService
  }

  /**
   * Create CipherAgent instance. Protected to allow test overrides.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected createCipherAgent(llmConfig: any, brvConfig: BrvConfig): CipherAgent {
    return new CipherAgent(llmConfig, brvConfig)
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
   * Execute with an injected agent (v7 architecture).
   * UseCase receives agent from TaskProcessor, doesn't manage agent lifecycle.
   *
   * Key differences from runForTransport:
   * - Agent is passed in (already started, long-lived)
   * - No agent.start() or lifecycle management
   * - Agent memory persists across multiple calls
   */
  public async executeWithAgent(
    agent: ICipherAgent,
    options: CurateExecuteOptions,
    callbacks?: CurateTransportCallbacks,
  ): Promise<void> {
    const {content, fileReferenceInstructions} = options

    // Initialize storage for tool call tracking
    const storage = await getAgentStorage()
    let executionId: null | string = null

    try {
      // Create execution with status='running'
      executionId = storage.createExecution('curate', content)

      // Build prompt with optional file reference instructions
      const prompt = fileReferenceInstructions ? `${content}\n${fileReferenceInstructions}` : content

      callbacks?.onStarted?.()

      // Setup streaming via event bus (agent already started, has event bus)
      // Note: We cast to CipherAgent to access agentEventBus (not exposed in ICipherAgent)
      const cipherAgent = agent as CipherAgent
      if (cipherAgent.agentEventBus) {
        this.setupStreamingCallbacks(cipherAgent, callbacks, executionId)
      }

      // Execute with autonomous mode and curate commandType
      // Use a unique sessionId for this execution within the long-lived agent
      // Note: Cast to CipherAgent for full execute signature (ICipherAgent is minimal)
      const sessionId = this.generateSessionId()
      const response = await cipherAgent.execute(prompt, sessionId, {
        executionContext: {commandType: 'curate'},
        mode: 'autonomous',
      })

      // Mark execution as completed
      storage.updateExecutionStatus(executionId, 'completed', response)

      // Notify completion
      callbacks?.onCompleted?.(response)

      // Cleanup old executions
      storage.cleanupOldExecutions(100)
    } catch (error) {
      // Mark execution as failed
      if (executionId) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        storage.updateExecutionStatus(executionId, 'failed', undefined, errorMessage)
      }

      callbacks?.onError?.(error instanceof Error ? error.message : String(error))
    }
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
        const selectedItem = await this.terminal.fileSelector({
          allowCancel: true,
          basePath: contextTreePath,
          filter: (item) => item.isDirectory,
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
          type: 'directory',
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
        this.terminal.log('Invalid selection. Please choose a valid location within the context tree.')
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
   * Prompt user to enter topic name with validation
   * @param targetPath - The path where the topic folder will be created
   * @returns The topic name or null if cancelled
   */
  protected async promptForTopicName(targetPath: string): Promise<null | string> {
    try {
      const topicName = await this.terminal.input({
        message: 'New topic name:',
        validate: (value) => this.validateTopicName(value, targetPath),
      })

      return topicName.trim()
    } catch {
      return null
    }
  }

  public async run(options: CurateUseCaseRunOptions): Promise<void> {
    await this.trackingService.track('mem:curate', {status: 'started'})
    // Determine mode: autonomous if context is provided
    return options.context ? this.runAutonomous(options.context, options) : this.runInteractive()
  }

  /**
   * Run in Transport mode (headless, with callbacks).
   * Called by TaskProcessor - streams results via callbacks.
   */
  public async runForTransport(
    options: CurateTransportOptions,
    callbacks?: CurateTransportCallbacks,
  ): Promise<void> {
    const {authToken, brvConfig, content, fileReferenceInstructions} = options

    // Initialize storage for tool call tracking
    const storage = await getAgentStorage()
    let executionId: null | string = null

    try {
      // Validate brvConfig
      if (!brvConfig) {
        callbacks?.onError?.('Project not initialized. Please run "brv init" first.')
        return
      }

      // Create execution with status='running'
      executionId = storage.createExecution('curate', content)

      // Build prompt with optional file reference instructions
      const prompt = fileReferenceInstructions
        ? `${content}\n${fileReferenceInstructions}`
        : content

      // Create LLM config
      const envConfig = getCurrentConfig()
      const llmConfig = {
        accessToken: authToken.accessToken,
        apiBaseUrl: envConfig.llmApiBaseUrl,
        fileSystemConfig: {workingDirectory: process.cwd()},
        maxIterations: 10,
        maxTokens: 4096,
        model: 'gemini-2.5-pro',
        projectId: PROJECT,
        sessionKey: authToken.sessionKey,
        temperature: 0.7,
        topK: 10,
        topP: 0.95,
        verbose: false,
      }

      // Create and start CipherAgent
      const agent = this.createCipherAgent(llmConfig, brvConfig)

      callbacks?.onStarted?.()
      await agent.start()

      try {
        const sessionId = this.generateSessionId()

        // Setup streaming via event bus
        if (agent.agentEventBus) {
          this.setupStreamingCallbacks(agent, callbacks, executionId)
        }

        // Execute with autonomous mode and curate commandType
        const response = await agent.execute(prompt, sessionId, {
          executionContext: {commandType: 'curate'},
          mode: 'autonomous',
        })

        // Mark execution as completed
        storage.updateExecutionStatus(executionId, 'completed', response)

        // Notify completion
        callbacks?.onCompleted?.(response)
      } finally {
        // Cleanup old executions
        storage.cleanupOldExecutions(100)
      }
    } catch (error) {
      // Mark execution as failed
      if (executionId) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        storage.updateExecutionStatus(executionId, 'failed', undefined, errorMessage)
      }

      callbacks?.onError?.(error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Handle workspace not initialized error
   */
  private handleWorkspaceError(_error: WorkspaceNotInitializedError): void {
    const message = 'Project not initialized. Please run "/init" to select your team and workspace.'
    this.terminal.log(message)
  }

  /**
   * Process file paths from --files flag
   * @param filePaths - Array of file paths (relative or absolute)
   * @returns Formatted instructions for the agent to read the specified files, or undefined if validation fails
   */
  private processFileReferences(filePaths: string[]): string | undefined {
    const MAX_FILES = 5

    if (!filePaths || filePaths.length === 0) {
      return ''
    }

    // Validate max files and truncate if needed
    if (filePaths.length > MAX_FILES) {
      const ignored = filePaths.slice(MAX_FILES)
      this.terminal.log(`\n⚠️  Only the first ${MAX_FILES} files will be processed. Ignoring: ${ignored.join(', ')}\n`)
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

    // If there are any validation errors, show them and return undefined
    if (errors.length > 0) {
      this.terminal.log('\n❌ File validation failed:\n')
      this.terminal.log(errors.join('\n'))
      this.terminal.log('')
      this.terminal.log('Invalid files provided. Please fix the errors above and try again.')
      return undefined
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
   * Run in autonomous mode - push to queue for background processing
   */
  private async runAutonomous(
    content: string,
    options: {
      apiKey?: string
      files?: string[]
      model?: string
      verbose?: boolean
    },
  ): Promise<void> {
    try {
      // Get authentication token
      const token = await this.tokenStore.load()
      if (!token) {
        this.terminal.log('Authentication required. Please run "/login" first.')
        return
      }

      // Load project config
      const brvConfig = await this.projectConfigStore.read()

      // Validate workspace is initialized
      if (!brvConfig) {
        throw new WorkspaceNotInitializedError(
          'Project not initialized. Please run "/init" to select your team and workspace.',
          '.brv',
        )
      }

      // Process file references if provided (validates and creates instructions)
      const fileReferenceInstructions = this.processFileReferences(options.files ?? [])
      if (fileReferenceInstructions === undefined) {
        // Validation failed, error already displayed
        return
      }

      // Initialize storage and create execution (auto-detects .brv/blobs)
      const storage = await getAgentStorage()

      // Create execution with status='queued'
      storage.createExecution(
        'curate',
        JSON.stringify({
          content,
          fileReferenceInstructions,
          flags: {apiKey: options.apiKey, model: options.model, verbose: options.verbose},
        }),
      )
      // Simple output for agents - just confirm saved
      this.terminal.log('✓ Context queued for processing.')

      // Track the event
      await this.trackingService.track('mem:curate', {status: 'finished'})
    } catch (error) {
      if (error instanceof WorkspaceNotInitializedError) {
        this.handleWorkspaceError(error)
        return
      }

      // Display error
      const errMsg = error instanceof Error ? error.message : 'Runtime error occurred'
      await this.trackingService.track('mem:curate', {message: errMsg, status: 'error'})
      this.terminal.error(errMsg)
    }
  }

  /**
   * Run in interactive mode with manual prompts
   */
  private async runInteractive(): Promise<void> {
    try {
      // Navigate to target location in context tree
      const targetPath = await this.navigateContextTree()

      if (!targetPath) {
        this.terminal.log('\nOperation cancelled.')
        return
      }

      // Prompt for topic name with validation
      const topicName = await this.promptForTopicName(targetPath)

      if (!topicName) {
        this.terminal.log('\nOperation cancelled.')
        return
      }

      // Create the topic folder with context.md
      const contextFilePath = this.createTopicWithContextFile(targetPath, topicName)
      this.terminal.log(`\nCreated: ${path.relative(process.cwd(), contextFilePath)}`)

      // Track the event
      this.trackingService.track('mem:curate')

      // Auto-open context.md in default editor
      this.terminal.log('Opening context.md for editing...')
      await this.openFile(contextFilePath)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unexpected error occurred'
      await this.trackingService.track('mem:curate', {message: errMsg, status: 'error'})
      this.terminal.error(errMsg)
    }
  }

  /**
   * Setup streaming callbacks for Transport mode.
   * Streams LLM response chunks and tracks tool calls.
   */
  private setupStreamingCallbacks(
    agent: CipherAgent,
    callbacks: CurateTransportCallbacks | undefined,
    executionId: string,
  ): void {
    if (!agent.agentEventBus) return

    const eventBus = agent.agentEventBus
    const storage = getAgentStorageSync()
    const toolCallMap = new Map<string, string>()

    // Stream LLM response chunks
    eventBus.on('llmservice:response', (payload) => {
      if (payload.content) {
        callbacks?.onChunk?.(payload.content)
      }
    })

    // Track and stream tool calls
    eventBus.on('llmservice:toolCall', (payload) => {
      try {
        if (!payload.callId) return

        // Stream tool call to CLI
        callbacks?.onToolCall?.({
          args: payload.args as Record<string, unknown> | undefined,
          callId: payload.callId,
          name: payload.toolName,
        })

        // Persist to DB
        const toolCallId = storage.addToolCall(executionId, {
          args: payload.args,
          name: payload.toolName,
        })
        toolCallMap.set(payload.callId, toolCallId)
      } catch {
        // Ignore errors - don't break execution
      }
    })

    // Track and stream tool results
    eventBus.on('llmservice:toolResult', (payload) => {
      try {
        if (!payload.callId) return

        // Stream tool result to CLI
        callbacks?.onToolResult?.({
          callId: payload.callId,
          error: payload.error,
          result: payload.result,
          success: payload.success,
        })

        // Persist to DB
        const toolCallId = toolCallMap.get(payload.callId)
        if (toolCallId) {
          let result: string
          if (payload.success) {
            result = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result)
          } else {
            const errorMsg = payload.error ?? 'Unknown error'
            result = JSON.stringify({error: errorMsg})
          }

          storage.updateToolCall(toolCallId, payload.success ? 'completed' : 'failed', {
            result,
          })
        }
      } catch {
        // Ignore errors - don't break execution
      }
    })
  }

  private validateTopicName(value: string, targetPath: string): boolean | string {
    const trimmed = value.trim()
    if (!trimmed) {
      return 'Topic name cannot be empty'
    }

    // Only allow letters, numbers, and hyphens
    if (!/^[a-zA-Z0-9-]+$/.test(trimmed)) {
      return 'Topic name can only contain letters (a-z, A-Z), numbers (0-9), and hyphens (-)'
    }

    // Check if folder already exists
    const topicPath = path.join(targetPath, trimmed)
    if (fs.existsSync(topicPath)) {
      return `Topic "${trimmed}" already exists at this location`
    }

    return true
  }
}
