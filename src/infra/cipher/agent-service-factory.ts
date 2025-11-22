import {join} from 'node:path'

import type {FileSystemConfig} from '../../core/domain/cipher/file-system/types.js'
import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {CipherAgentServices, SessionServices} from '../../core/interfaces/cipher/cipher-services.js'
import type {ICodingAgentLogParser} from '../../core/interfaces/cipher/i-coding-agent-log-parser.js'
import type {ICodingAgentLogWatcher} from '../../core/interfaces/cipher/i-coding-agent-log-watcher.js'
import type {IFileWatcherService} from '../../core/interfaces/i-file-watcher-service.js'

import {FileWatcherService} from '../watcher/file-watcher-service.js'
import {FileBlobStorage} from './blob/file-blob-storage.js'
import {AgentEventBus, SessionEventBus} from './events/event-emitter.js'
import {FileSystemService} from './file-system/file-system-service.js'
import {ByteRoverLlmGrpcService} from './grpc/internal-llm-grpc-service.js'
import {ByteRoverLLMService} from './llm/internal-llm-service.js'
import {OpenRouterLLMService} from './llm/openrouter-llm-service.js'
import {MemoryManager} from './memory/memory-manager.js'
import {CodingAgentLogParser} from './parsers/coding-agent-log-parser.js'
import {ProcessService} from './process/process-service.js'
import {BlobHistoryStorage} from './storage/blob-history-storage.js'
import {SimplePromptFactory} from './system-prompt/simple-prompt-factory.js'
import {ToolManager} from './tools/tool-manager.js'
import {ToolProvider} from './tools/tool-provider.js'
import {CodingAgentLogWatcher} from './watcher/coding-agent-log-watcher.js'

/**
 * LLM configuration for CipherAgent
 */
export interface CipherLLMConfig {
  accessToken: string
  apiKey?: string
  fileSystemConfig?: Partial<FileSystemConfig>
  grpcEndpoint: string
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
  verbose?: boolean
}

/**
 * gRPC configuration for ByteRover LLM service
 */
export interface ByteRoverGrpcConfig {
  accessToken: string
  grpcEndpoint: string
  projectId: string
  region?: string
  sessionKey: string
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
 * @param brvConfig - Optional ByteRover config (for coding agent parser and custom system prompt)
 * @returns Initialized shared services
 */
export async function createCipherAgentServices(
  llmConfig: CipherLLMConfig,
  brvConfig?: BrvConfig,
): Promise<CipherAgentServices> {
  // 1. Agent event bus (global)
  const agentEventBus = new AgentEventBus()

  // 2. File system service (no dependencies)
  const fileSystemService = new FileSystemService(llmConfig.fileSystemConfig)
  await fileSystemService.initialize()

  // 3. Process service (no dependencies)
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

  // 4. Blob storage (no dependencies)
  const blobStorage = new FileBlobStorage({
    maxBlobSize: 100 * 1024 * 1024, // 100MB
    maxTotalSize: 1024 * 1024 * 1024, // 1GB
    storageDir: join(workingDirectory, '.brv', 'blobs'),
  })
  await blobStorage.initialize()

  // 5. Memory system (depends on BlobStorage)
  const memoryManager = new MemoryManager(blobStorage)

  // 6. Simple prompt factory - SHARED across sessions
  // Created early so it can be used by ToolProvider
  const verbose = llmConfig.verbose ?? false
  const promptFactory = new SimplePromptFactory(undefined, verbose)

  // 7. Tool system (depends on FileSystemService, ProcessService, MemoryManager, PromptFactory)
  const toolProvider = new ToolProvider(
    {
      fileSystemService,
      memoryManager,
      processService,
    },
    promptFactory,
  )
  await toolProvider.initialize()
  const toolManager = new ToolManager(toolProvider)
  await toolManager.initialize()

  // 9. History storage (depends on BlobStorage) - SHARED across sessions
  const historyStorage = new BlobHistoryStorage(blobStorage)

  // 9. Coding agent log watcher
  let codingAgentLogWatcher: ICodingAgentLogWatcher | undefined
  if (brvConfig) {
    const fileWatcherService: IFileWatcherService = new FileWatcherService()
    const parser: ICodingAgentLogParser = new CodingAgentLogParser(brvConfig.chatLogPath, brvConfig.ide)
    codingAgentLogWatcher = new CodingAgentLogWatcher(fileWatcherService, parser)
  }

  return {
    agentEventBus,
    blobStorage,
    codingAgentLogWatcher,
    fileSystemService,
    historyStorage,
    memoryManager,
    processService,
    promptFactory,
    toolManager,
    toolProvider,
  }
}

/**
 * Creates session-specific services for a ChatSession.
 *
 * Following Dexto's pattern: each session gets its own LLM service and event bus
 * for conversation isolation, while using shared services for tools/prompts.
 *
 * @param sessionId - Unique session identifier
 * @param sharedServices - Shared services from agent
 * @param grpcConfig - gRPC configuration
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
  grpcConfig: ByteRoverGrpcConfig,
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

  // 2. Create LLM service based on configuration
  // Priority: OpenRouter > ByteRover gRPC
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
        model: llmConfig.model ?? 'anthropic/claude-haiku-4.5',
        siteName: llmConfig.siteName,
        temperature: llmConfig.temperature ?? 0.7,
        verbose: llmConfig.verbose ?? false,
      },
      {
        memoryManager: sharedServices.memoryManager, // SHARED
        sessionEventBus,
        systemPromptManager: sharedServices.promptFactory, // SHARED
        toolManager: sharedServices.toolManager, // SHARED
      },
    )
  } else {
    // Use gRPC backend service (default)
    const grpcService = new ByteRoverLlmGrpcService({
      accessToken: grpcConfig.accessToken,
      grpcEndpoint: grpcConfig.grpcEndpoint,
      projectId: grpcConfig.projectId,
      region: grpcConfig.region,
      sessionKey: grpcConfig.sessionKey,
      timeout: grpcConfig.timeout,
    })

    llmService = new ByteRoverLLMService(
      sessionId,
      grpcService,
      {
        maxIterations: llmConfig.maxIterations ?? 50,
        maxTokens: llmConfig.maxTokens ?? 8192,
        model: llmConfig.model ?? 'gemini-2.5-flash',
        temperature: llmConfig.temperature ?? 0.7,
        verbose: llmConfig.verbose ?? false,
      },
      {
        historyStorage: sharedServices.historyStorage, // SHARED
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
