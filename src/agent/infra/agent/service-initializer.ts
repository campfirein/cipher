/**
 * Service Initializer: Centralized Wiring for Cipher Agent Services
 *
 * This module is responsible for initializing and wiring together all core agent services.
 * It provides a single entry point for constructing the service graph.
 *
 * Following DextoAgent pattern:
 * - Config file is source of truth (ValidatedAgentConfig)
 * - Centralized function (not factory class) for service creation
 * - Explicit dependency order with numbered steps
 * - Event bus passed in as parameter (created in agent constructor)
 */

import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

import type {CipherAgentServices, SessionServices} from '../../core/interfaces/cipher-services.js'
import type {IContentGenerator} from '../../core/interfaces/i-content-generator.js'
import type {IHistoryStorage} from '../../core/interfaces/i-history-storage.js'
import type {ValidatedAgentConfig} from './agent-schemas.js'

import {createBlobStorage} from '../blob/blob-storage-factory.js'
import {AgentEventBus, SessionEventBus} from '../events/event-emitter.js'
import {FileSystemService} from '../file-system/file-system-service.js'
import {ByteRoverLlmHttpService} from '../http/internal-llm-http-service.js'
import {CompactionService} from '../llm/context/compaction/compaction-service.js'
import {ByteRoverContentGenerator, LoggingContentGenerator, RetryableContentGenerator} from '../llm/generators/index.js'
import {ByteRoverLLMService} from '../llm/internal-llm-service.js'
import {OpenRouterLLMService} from '../llm/openrouter-llm-service.js'
import {DEFAULT_RETRY_POLICY} from '../llm/retry/retry-policy.js'
import {GeminiTokenizer} from '../llm/tokenizers/gemini-tokenizer.js'
import {EventBasedLogger} from '../logger/event-based-logger.js'
import {MemoryManager} from '../memory/memory-manager.js'
import {ProcessService} from '../process/process-service.js'
import {BlobHistoryStorage} from '../storage/blob-history-storage.js'
import {DualFormatHistoryStorage} from '../storage/dual-format-history-storage.js'
import {GranularHistoryStorage} from '../storage/granular-history-storage.js'
import {MessageStorageService} from '../storage/message-storage-service.js'
import {SqliteKeyStorage} from '../storage/sqlite-key-storage.js'
import {ContextTreeStructureContributor} from '../system-prompt/contributors/context-tree-structure-contributor.js'
import {SystemPromptManager} from '../system-prompt/system-prompt-manager.js'
import {CoreToolScheduler} from '../tools/core-tool-scheduler.js'
import {DEFAULT_POLICY_RULES} from '../tools/default-policy-rules.js'
import {PolicyEngine} from '../tools/policy-engine.js'
import {ToolDescriptionLoader} from '../tools/tool-description-loader.js'
import {ToolManager} from '../tools/tool-manager.js'
import {ToolProvider} from '../tools/tool-provider.js'

/**
 * HTTP configuration for ByteRover LLM service.
 *
 * projectId, sessionKey, spaceId, teamId accept either a static string or a provider function.
 * Provider functions are resolved lazily on each HTTP request,
 * so long-lived agents always get the latest values from the StateServer.
 */
export interface ByteRoverHttpConfig {
  apiBaseUrl: string
  projectId: (() => string) | string
  region?: string
  sessionKey: (() => string) | string
  spaceId: (() => string) | string
  teamId: (() => string) | string
  timeout?: number
}

/**
 * LLM configuration for per-session services.
 */
export interface SessionLLMConfig {
  httpReferer?: string
  maxIterations?: number
  maxTokens?: number
  model: string
  openRouterApiKey?: string
  siteName?: string
  temperature?: number
  verbose?: boolean
}

// Re-export service types for convenience
export type {CipherAgentServices, SessionManagerConfig, SessionServices} from '../../core/interfaces/cipher-services.js'

/**
 * Creates shared services for CipherAgent.
 * These services are singletons shared across all sessions.
 *
 * Initialization order follows DextoAgent pattern (explicit numbered steps):
 * 1. Logger (uses provided event bus)
 * 2. File system service (no dependencies)
 * 3. Process service (no dependencies)
 * 4. Blob storage (no dependencies)
 * 5. Memory system (depends on BlobStorage, Logger)
 * 6. System prompt manager (no dependencies)
 * 7. Tool provider (depends on FileSystemService, ProcessService, MemoryManager)
 * 8. Policy engine (no dependencies)
 * 9. Tool scheduler (depends on ToolProvider, PolicyEngine)
 * 10. Tool manager (depends on ToolProvider, ToolScheduler)
 * 11. History storage (depends on BlobStorage)
 * 12. Return all services
 *
 * @param config - Validated agent configuration (Zod-validated)
 * @param agentEventBus - Pre-created event bus from agent constructor (DextoAgent pattern)
 * @returns Initialized shared services
 */
export async function createCipherAgentServices(
  config: ValidatedAgentConfig,
  agentEventBus: AgentEventBus,
): Promise<CipherAgentServices> {
  // 1. Logger (uses provided event bus - DextoAgent pattern)
  const logger = new EventBasedLogger(agentEventBus, 'CipherAgent')

  // 2. File system service (no dependencies)
  const fileSystemService = new FileSystemService(config.fileSystem)
  await fileSystemService.initialize()

  // 3. Process service (no dependencies)
  const workingDirectory = config.fileSystem?.workingDirectory ?? process.cwd()
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

  // Storage base path: XDG storagePath (daemon mode) or .brv/ fallback (REPL mode)
  const storageBasePath = config.storagePath ?? join(workingDirectory, '.brv')

  // 4. Blob storage (no dependencies)
  const blobStorage = createBlobStorage(
    config.blobStorage ?? {
      maxBlobSize: 100 * 1024 * 1024, // 100MB
      maxTotalSize: 1024 * 1024 * 1024, // 1GB
      storageDir: storageBasePath,
    },
  )
  await blobStorage.initialize()

  // 5. Memory system (depends on BlobStorage, Logger)
  const memoryLogger = logger.withSource('MemoryManager')
  const memoryManager = new MemoryManager(blobStorage, memoryLogger)

  // 6. System prompt manager - SHARED across sessions
  // Calculate path to prompts directory relative to this file's location
  // This file is at dist/agent/core/service-initializer.js
  // Resources are at dist/resources/prompts/
  const currentDir = dirname(fileURLToPath(import.meta.url))
  const promptsBasePath = join(currentDir, '../../resources/prompts')

  const systemPromptManager = new SystemPromptManager({
    basePath: promptsBasePath,
    validateConfig: true,
  })
  // Register default contributors
  systemPromptManager.registerContributors([
    {enabled: true, filepath: 'system-prompt.yml', id: 'base', priority: 0, type: 'file'},
    {enabled: true, id: 'env', priority: 10, type: 'environment'},
    {enabled: true, id: 'memories', priority: 20, type: 'memory'},
    {enabled: true, id: 'datetime', priority: 30, type: 'dateTime'},
  ])

  // Register context tree structure contributor for query/curate commands
  // This injects the .brv/context-tree structure into the system prompt,
  // giving agents immediate awareness of available curated knowledge.
  // Priority 15 ensures it appears after environment but before memories.
  const contextTreeContributor = new ContextTreeStructureContributor('contextTree', 15, {
    workingDirectory,
  })
  systemPromptManager.registerContributor(contextTreeContributor)

  // 7. Tool provider (depends on FileSystemService, ProcessService, MemoryManager, SystemPromptManager)
  const verbose = config.llm.verbose ?? false
  const descriptionLoader = new ToolDescriptionLoader()
  const toolProvider: ToolProvider = new ToolProvider(
    {
      fileSystemService,
      getToolProvider: (): ToolProvider => toolProvider,
      memoryManager,
      processService,
    },
    systemPromptManager,
    descriptionLoader,
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
  let historyStorage: IHistoryStorage
  let compactionService: CompactionService | undefined
  let messageStorageService: MessageStorageService | undefined

  if (config.useGranularStorage) {
    // Create granular storage infrastructure
    const keyStorage = new SqliteKeyStorage({
      storageDir: storageBasePath,
    })
    await keyStorage.initialize()

    const messageStorage = new MessageStorageService(keyStorage)
    messageStorageService = messageStorage
    const granularStorage = new GranularHistoryStorage(messageStorage)
    const blobHistoryStorage = new BlobHistoryStorage(blobStorage)

    // DualFormatHistoryStorage routes between formats:
    // - New sessions → GranularHistoryStorage
    // - Existing sessions → BlobHistoryStorage (no migration)
    historyStorage = new DualFormatHistoryStorage(blobHistoryStorage, granularStorage)

    // Create CompactionService for context overflow management
    const tokenizer = new GeminiTokenizer(config.model ?? 'gemini-3-flash-preview')
    compactionService = new CompactionService(messageStorage, tokenizer, {
      overflowThreshold: 0.85, // 85% triggers compaction check
      protectedTurns: 2, // Protect first 2 user turns from pruning
      pruneKeepTokens: 40_000, // Keep 40k tokens in tool outputs
      pruneMinimumTokens: 20_000, // Only prune if 20k+ tokens can be saved
    })

    logger.info('Granular history storage enabled for new sessions')
  } else {
    // Default: use blob storage for all sessions
    historyStorage = new BlobHistoryStorage(blobStorage)
  }

  // 12. Log successful initialization
  logger.info('CipherAgent services initialized successfully', {
    model: config.model,
    verbose: config.llm.verbose,
    workingDirectory,
  })

  return {
    agentEventBus,
    blobStorage,
    compactionService,
    fileSystemService,
    historyStorage,
    memoryManager,
    messageStorageService,
    policyEngine,
    processService,
    systemPromptManager,
    toolManager,
    toolProvider,
    toolScheduler,
  }
}

/**
 * Creates session-specific services for a ChatSession.
 * Generator composition order (innermost to outermost):
 * 1. Base generator (ByteRoverContentGenerator or OpenRouterContentGenerator)
 * 2. RetryableContentGenerator - handles transient errors with backoff
 * 3. LoggingContentGenerator - debug logging (if verbose enabled)
 *
 * @param sessionId - Unique session identifier
 * @param sharedServices - Shared services from agent
 * @param httpConfig - HTTP configuration
 * @param llmConfig - LLM service configuration
 * @returns Initialized session services
 */
export function createSessionServices(
  sessionId: string,
  sharedServices: CipherAgentServices,
  httpConfig: ByteRoverHttpConfig,
  llmConfig: SessionLLMConfig,
): SessionServices {
  // 1. Create session-specific event bus
  const sessionEventBus = new SessionEventBus()

  // 2. Create session-scoped logger
  const sessionLogger = new EventBasedLogger(sharedServices.agentEventBus, 'LLMService', sessionId)

  // 3. Create LLM service based on configuration
  // Priority: OpenRouter > ByteRover HTTP
  let llmService

  if (llmConfig.openRouterApiKey) {
    // Use OpenRouter service when OpenRouter API key is provided
    llmService = new OpenRouterLLMService(
      sessionId,
      {
        apiKey: llmConfig.openRouterApiKey,
        httpReferer: llmConfig.httpReferer,
        maxIterations: llmConfig.maxIterations ?? 50,
        maxTokens: llmConfig.maxTokens ?? 8192,
        model: llmConfig.model ?? 'google/gemini-3-flash-preview',
        siteName: llmConfig.siteName,
        temperature: llmConfig.temperature ?? 0.7,
        verbose: llmConfig.verbose ?? false,
      },
      {
        logger: sessionLogger,
        memoryManager: sharedServices.memoryManager, // SHARED
        sessionEventBus,
        systemPromptManager: sharedServices.systemPromptManager, // SHARED
        toolManager: sharedServices.toolManager, // SHARED
      },
    )
  } else {
    // Use HTTP backend service (default) with generator pattern

    // Step 1: Create HTTP service
    const httpService = new ByteRoverLlmHttpService({
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
      model: llmConfig.model ?? 'gemini-3-flash-preview',
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
        model: llmConfig.model ?? 'gemini-3-flash-preview',
        temperature: llmConfig.temperature ?? 0.7,
        verbose: llmConfig.verbose ?? false,
      },
      {
        compactionService: sharedServices.compactionService, // SHARED - for context overflow management
        historyStorage: sharedServices.historyStorage, // SHARED
        logger: sessionLogger,
        memoryManager: sharedServices.memoryManager, // SHARED
        sessionEventBus,
        systemPromptManager: sharedServices.systemPromptManager, // SHARED
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
