import {GoogleGenAI} from '@google/genai'
import {join} from 'node:path'

import type {FileSystemConfig} from '../../core/domain/cipher/file-system/types.js'
import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {CipherAgentServices, SessionServices} from '../../core/interfaces/cipher/cipher-services.js'

import {FileBlobStorage} from './blob/file-blob-storage.js'
import {AgentEventBus, SessionEventBus} from './events/event-emitter.js'
import {FileSystemService} from './file-system/file-system-service.js'
import {ByteRoverLlmGrpcService} from './grpc/internal-llm-grpc-service.js'
import {GeminiLLMService} from './llm/gemini-llm-service.js'
import {ByteRoverLLMService} from './llm/internal-llm-service.js'
import {MemoryManager} from './memory/memory-manager.js'
import {ProcessService} from './process/process-service.js'
import {BlobHistoryStorage} from './storage/blob-history-storage.js'
import {SystemPromptManager} from './system-prompt/system-prompt-manager.js'
import {ToolManager} from './tools/tool-manager.js'
import {ToolProvider} from './tools/tool-provider.js'

/**
 * LLM configuration for CipherAgent
 */
export interface CipherLLMConfig {
  accessToken: string
  apiKey?: string
  fileSystemConfig?: Partial<FileSystemConfig>
  grpcEndpoint: string
  maxIterations?: number
  maxTokens?: number
  model: string
  projectId: string
  region?: string
  sessionKey: string
  temperature?: number
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
export type {CipherAgentServices, SessionManagerConfig, SessionServices} from '../../core/interfaces/cipher/cipher-services.js'

/**
 * Creates shared services for CipherAgent.
 * These services are singletons shared across all sessions.
 *
 * Following Dexto's pattern: shared services are created once at agent level,
 * while session-specific services (LLM, EventBus) are created per session.
 *
 * @param llmConfig - LLM configuration
 * @param brvConfig - Optional ByteRover config (for custom system prompt)
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

  // 6. Create a stub ContextManager for ContextTreeService initialization
  // Note: This is a placeholder. The actual ContextManager is session-specific
  // and is accessed via LLM service's getContextManager() at runtime

  // 7. Tool system (depends on FileSystemService, ProcessService, ContextTreeService)
  const toolProvider = new ToolProvider({
    fileSystemService,
    processService,
  })
  await toolProvider.initialize()
  const toolManager = new ToolManager(toolProvider)
  await toolManager.initialize()

  // 8. System prompt manager (with memory integration) - SHARED across sessions
  const customPrompt = brvConfig?.cipherAgentSystemPrompt
  const systemPromptManager = new SystemPromptManager(
    {
      contributors: [
        {
          // Use custom prompt if provided (backward compatibility), otherwise load from YAML
          content: customPrompt,
          enabled: true,
          id: 'static',
          priority: 0,
          type: 'static',
        },
        {
          enabled: true,
          id: 'markerPrompt',
          priority: 3,
          type: 'markerPrompt',
        },
        {
          enabled: true,
          id: 'executionMode',
          priority: 1,
          type: 'executionMode',
        },
        {
          enabled: true,
          id: 'dateTime',
          priority: 10,
          type: 'dateTime',
        },
        {
          enabled: true,
          id: 'agentMemories',
          options: {
            includeTags: true,
            includeTimestamps: false,
            limit: 20,
          },
          priority: 20,
          type: 'memory',
        },
      ],
    },
    memoryManager,
  )

  // 9. History storage (depends on BlobStorage) - SHARED across sessions
  const historyStorage = new BlobHistoryStorage(blobStorage)

  return {
    agentEventBus,
    blobStorage,
    fileSystemService,
    historyStorage,
    memoryManager,
    processService,
    systemPromptManager,
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
 * @param llmConfig.apiKey - Optional Gemini API key for direct service
 * @param llmConfig.maxIterations - Maximum iterations for agentic loop
 * @param llmConfig.maxTokens - Maximum output tokens
 * @param llmConfig.model - LLM model identifier
 * @param llmConfig.temperature - Temperature for generation
 * @returns Initialized session services
 */
export function createSessionServices(
  sessionId: string,
  sharedServices: CipherAgentServices,
  grpcConfig: ByteRoverGrpcConfig,
  llmConfig: {
    apiKey?: string
    maxIterations?: number
    maxTokens?: number
    model: string
    temperature?: number
  },
): SessionServices {
  // 1. Create session-specific event bus
  const sessionEventBus = new SessionEventBus()

  // 2. Create LLM service based on configuration
  let llmService

  if (llmConfig.apiKey) {
    // Use direct Gemini service when API key is provided
    const geminiClient = new GoogleGenAI({
      apiKey: llmConfig.apiKey,
    })

    llmService = new GeminiLLMService(
      sessionId,
      geminiClient,
      {
        apiKey: llmConfig.apiKey,
        maxIterations: llmConfig.maxIterations ?? 50,
        maxTokens: llmConfig.maxTokens ?? 8192,
        model: llmConfig.model ?? 'gemini-2.0-flash-exp',
        temperature: llmConfig.temperature ?? 0.7,
      },
      {
        sessionEventBus,
        systemPromptManager: sharedServices.systemPromptManager, // SHARED
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
        model: llmConfig.model ?? 'gemini-2.5-pro',
        temperature: llmConfig.temperature ?? 0.7,
      },
      {
        historyStorage: sharedServices.historyStorage, // SHARED
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
