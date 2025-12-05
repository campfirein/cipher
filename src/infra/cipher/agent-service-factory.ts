import {join} from 'node:path'

import type {BlobStorageConfig} from '../../core/domain/cipher/blob/types.js'
import type {FileSystemConfig} from '../../core/domain/cipher/file-system/types.js'
import type {CipherAgentServices, SessionServices} from '../../core/interfaces/cipher/cipher-services.js'
import type {IContentGenerator} from '../../core/interfaces/cipher/i-content-generator.js'

import {createBlobStorage} from './blob/blob-storage-factory.js'
import {AgentEventBus, SessionEventBus} from './events/event-emitter.js'
import {FileSystemService} from './file-system/file-system-service.js'
import {ByteRoverLlmHttpService} from './http/internal-llm-http-service.js'
import {ByteRoverContentGenerator, LoggingContentGenerator, RetryableContentGenerator} from './llm/generators/index.js'
import {ByteRoverLLMService} from './llm/internal-llm-service.js'
import {OpenRouterLLMService} from './llm/openrouter-llm-service.js'
import {DEFAULT_RETRY_POLICY} from './llm/retry/retry-policy.js'
import {EventBasedLogger} from './logger/event-based-logger.js'
import {MemoryManager} from './memory/memory-manager.js'
import {ProcessService} from './process/process-service.js'
import {BlobHistoryStorage} from './storage/blob-history-storage.js'
import {SimplePromptFactory} from './system-prompt/simple-prompt-factory.js'
import {CoreToolScheduler} from './tools/core-tool-scheduler.js'
import {DEFAULT_POLICY_RULES} from './tools/default-policy-rules.js'
import {PolicyEngine} from './tools/policy-engine.js'
import {ToolManager} from './tools/tool-manager.js'
import {ToolProvider} from './tools/tool-provider.js'

/**
 * LLM configuration for CipherAgent
 */
export interface CipherLLMConfig {
  accessToken: string
  apiBaseUrl: string
  apiKey?: string
  blobStorageConfig?: Partial<BlobStorageConfig>
  fileSystemConfig?: Partial<FileSystemConfig>
  httpReferer?: string
  maxIterations?: number
  maxTokens?: number
  model: string
  openRouterApiKey?: string
  projectId: string
  region?: string
  sessionKey: string
  siteName?: string
  temperature?: number
  topK?: number
  topP?: number
  verbose?: boolean
}

/**
 * HTTP configuration for ByteRover LLM service
 */
export interface ByteRoverHttpConfig {
  accessToken: string
  apiBaseUrl: string
  projectId: string
  region?: string
  sessionKey: string
  spaceId: string
  teamId: string
  timeout?: number
}

// Re-export service types for convenience
export type {
  CipherAgentServices,
  SessionManagerConfig,
  SessionServices,
} from '../../core/interfaces/cipher/cipher-services.js'

/**
 * Creates shared services for CipherAgent.
 * These services are singletons shared across all sessions.
 *
 * Following Dexto's pattern: shared services are created once at agent level,
 * while session-specific services (LLM, EventBus) are created per session.
 *
 * @param llmConfig - LLM configuration
 * @returns Initialized shared services
 */
export async function createCipherAgentServices(llmConfig: CipherLLMConfig): Promise<CipherAgentServices> {
  // 1. Agent event bus (global)
  const agentEventBus = new AgentEventBus()

  // 2. Logger (depends on event bus)
  const logger = new EventBasedLogger(agentEventBus, 'CipherAgent')

  // 3. File system service (no dependencies)
  const fileSystemService = new FileSystemService(llmConfig.fileSystemConfig)
  await fileSystemService.initialize()

  // 4. Process service (no dependencies)
  // Use the same working directory as FileSystemService to ensure consistency
  const workingDirectory = llmConfig.fileSystemConfig?.workingDirectory ?? process.cwd()
  const processService = new ProcessService({
    allowedCommands: [],
    blockedCommands: [],
    environment: {},
    maxConcurrentProcesses: 5,
    maxOutputBuffer: 1_048_576, // 1MB (1024 * 1024)
    maxTimeout: 600_000, // 10 minutes
    securityLevel: 'permissive', // Permissive mode: relies on working directory confinement
    workingDirectory,
  })
  await processService.initialize()

  // 5. Blob storage (no dependencies)
  // Always uses SQLite for performance and ACID transactions
  const blobStorage = createBlobStorage(
    llmConfig.blobStorageConfig ?? {
      maxBlobSize: 100 * 1024 * 1024, // 100MB
      maxTotalSize: 1024 * 1024 * 1024, // 1GB
      storageDir: join(workingDirectory, '.brv', 'blobs'),
    },
  )
  await blobStorage.initialize()

  // 6. Memory system (depends on BlobStorage, Logger)
  const memoryLogger = logger.withSource('MemoryManager')
  const memoryManager = new MemoryManager(blobStorage, memoryLogger)

  // 7. Simple prompt factory - SHARED across sessions
  // Created early so it can be used by ToolProvider
  const verbose = llmConfig.verbose ?? false
  const promptFactory = new SimplePromptFactory(undefined, verbose)

  // 8. Tool system (depends on FileSystemService, ProcessService, MemoryManager, PromptFactory)
  const toolProvider = new ToolProvider(
    {
      fileSystemService,
      memoryManager,
      processService,
    },
    promptFactory,
  )
  await toolProvider.initialize()

  // 8. Policy engine with default rules for autonomous execution
  const policyEngine = new PolicyEngine({defaultDecision: 'ALLOW'})
  policyEngine.addRules(DEFAULT_POLICY_RULES)

  // 9. Tool scheduler (orchestrates policy check → execution)
  const toolScheduler = new CoreToolScheduler(toolProvider, policyEngine, undefined, {
    verbose,
  })

  // 10. Tool manager (with scheduler for policy-based execution)
  const toolManager = new ToolManager(toolProvider, toolScheduler)
  await toolManager.initialize()

  // 11. History storage (depends on BlobStorage) - SHARED across sessions
  const historyStorage = new BlobHistoryStorage(blobStorage)

  // Log successful initialization
  logger.info('CipherAgent services initialized successfully', {
    model: llmConfig.model,
    verbose: llmConfig.verbose,
    workingDirectory,
  })

  return {
    agentEventBus,
    blobStorage,
    fileSystemService,
    historyStorage,
    memoryManager,
    policyEngine,
    processService,
    promptFactory,
    toolManager,
    toolProvider,
    toolScheduler,
  }
}

/**
 * Creates session-specific services for a ChatSession.
 *
 * Following Dexto's pattern: each session gets its own LLM service and event bus
 * for conversation isolation, while using shared services for tools/prompts.
 *
 * Generator composition order (innermost to outermost):
 * 1. Base generator (ByteRoverContentGenerator or OpenRouterContentGenerator)
 * 2. RetryableContentGenerator - handles transient errors with backoff
 * 3. LoggingContentGenerator - debug logging (if verbose enabled)
 *
 * @param sessionId - Unique session identifier
 * @param sharedServices - Shared services from agent
 * @param httpConfig - HTTP configuration
 * @param llmConfig - LLM service configuration
 * @param llmConfig.openRouterApiKey - Optional OpenRouter API key for OpenRouter service
 * @param llmConfig.httpReferer - Optional HTTP Referer for OpenRouter rankings
 * @param llmConfig.siteName - Optional site name for OpenRouter rankings
 * @param llmConfig.maxIterations - Maximum iterations for agentic loop
 * @param llmConfig.maxTokens - Maximum output tokens
 * @param llmConfig.model - LLM model identifier
 * @param llmConfig.temperature - Temperature for generation
 * @param llmConfig.verbose - Enable verbose debug output
 * @returns Initialized session services
 */
export function createSessionServices(
  sessionId: string,
  sharedServices: CipherAgentServices,
  httpConfig: ByteRoverHttpConfig,
  llmConfig: {
    httpReferer?: string
    maxIterations?: number
    maxTokens?: number
    model: string
    openRouterApiKey?: string
    siteName?: string
    temperature?: number
    verbose?: boolean
  },
): SessionServices {
  // 1. Create session-specific event bus
  const sessionEventBus = new SessionEventBus()

  // 2. Create session-scoped logger
  const sessionLogger = new EventBasedLogger(sharedServices.agentEventBus, 'LLMService', sessionId)

  // 3. Create LLM service based on configuration
  // Priority: OpenRouter > ByteRover gRPC
  let llmService

  if (llmConfig.openRouterApiKey) {
    // Use OpenRouter service when OpenRouter API key is provided
    // OpenRouterLLMService still uses old pattern (to be migrated later)
    llmService = new OpenRouterLLMService(
      sessionId,
      {
        apiKey: llmConfig.openRouterApiKey,
        httpReferer: llmConfig.httpReferer,
        maxIterations: llmConfig.maxIterations ?? 50,
        maxTokens: llmConfig.maxTokens ?? 8192,
        model: llmConfig.model ?? 'google/gemini-2.5-pro',
        siteName: llmConfig.siteName,
        temperature: llmConfig.temperature ?? 0.7,
        verbose: llmConfig.verbose ?? false,
      },
      {
        logger: sessionLogger,
        memoryManager: sharedServices.memoryManager, // SHARED
        sessionEventBus,
        systemPromptManager: sharedServices.promptFactory, // SHARED
        toolManager: sharedServices.toolManager, // SHARED
      },
    )
  } else {
    // Use HTTP backend service (default) with new generator pattern

    // Step 1: Create HTTP service
    const httpService = new ByteRoverLlmHttpService({
      accessToken: httpConfig.accessToken,
      apiBaseUrl: httpConfig.apiBaseUrl,
      projectId: httpConfig.projectId,
      region: httpConfig.region,
      sessionKey: httpConfig.sessionKey,
      spaceId: httpConfig.spaceId,
      teamId: httpConfig.teamId,
      timeout: httpConfig.timeout,
    })

    // Step 2: Create base content generator
    let generator: IContentGenerator = new ByteRoverContentGenerator(httpService, {
      maxTokens: llmConfig.maxTokens ?? 8192,
      model: llmConfig.model ?? 'gemini-2.5-pro',
      temperature: llmConfig.temperature ?? 0.7,
    })

    // Step 3: Wrap with retry decorator
    generator = new RetryableContentGenerator(generator, {
      eventBus: sessionEventBus,
      policy: DEFAULT_RETRY_POLICY,
    })

    // Step 4: Wrap with logging decorator (always, for spinner events)
    generator = new LoggingContentGenerator(generator, sessionEventBus, {
      logChunks: llmConfig.verbose,
      logRequests: llmConfig.verbose,
      logResponses: llmConfig.verbose,
      verbose: llmConfig.verbose,
    })

    // Step 5: Create LLM service with composed generator
    llmService = new ByteRoverLLMService(
      sessionId,
      generator,
      {
        maxIterations: llmConfig.maxIterations ?? 50,
        maxTokens: llmConfig.maxTokens ?? 8192,
        model: llmConfig.model ?? 'gemini-2.5-pro',
        temperature: llmConfig.temperature ?? 0.7,
        verbose: llmConfig.verbose ?? false,
      },
      {
        historyStorage: sharedServices.historyStorage, // SHARED
        logger: sessionLogger,
        memoryManager: sharedServices.memoryManager, // SHARED
        promptFactory: sharedServices.promptFactory, // SHARED
        sessionEventBus,
        toolManager: sharedServices.toolManager, // SHARED
      },
    )
  }

  // Event forwarding is handled by ChatSession.setupEventForwarding()
  // to ensure proper cleanup when sessions are disposed

  return {
    llmService,
    sessionEventBus,
  }
}
