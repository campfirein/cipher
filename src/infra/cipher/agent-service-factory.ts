import type {FileSystemConfig} from '../../core/domain/cipher/file-system/types.js'
import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {CipherAgentServices, SessionServices} from '../../core/interfaces/cipher/cipher-services.js'

import {FileBlobStorage} from './blob/file-blob-storage.js'
import {AgentEventBus, SessionEventBus} from './events/event-emitter.js'
import {FileSystemService} from './file-system/file-system-service.js'
import {ByteRoverLlmGrpcService} from './grpc/internal-llm-grpc-service.js'
import {ByteRoverLLMService} from './llm/internal-llm-service.js'
import {MemoryManager} from './memory/memory-manager.js'
import {ProcessService} from './process/process-service.js'
import {setupEventForwarding} from './session/session-event-forwarder.js'
import {BlobHistoryStorage} from './storage/blob-history-storage.js'
import {SystemPromptManager} from './system-prompt/system-prompt-manager.js'
import {ToolManager} from './tools/tool-manager.js'
import {ToolProvider} from './tools/tool-provider.js'

/**
 * Default system prompt for CipherAgent
 */
const DEFAULT_SYSTEM_PROMPT = `You are CipherAgent, an intelligent assistant specialized in helping users with coding tasks, analysis, and problem-solving.

You have access to file system tools that allow you to:
- Read files to understand codebases
- Search for files using glob patterns
- Search file contents using regex patterns
- Edit existing files
- Write new files

You also have access to command execution tools:
- bash_exec: Execute shell commands (foreground or background)
- bash_output: Retrieve output from background processes
- kill_process: Terminate background processes

Command execution security model:
- All commands are confined to your working directory (automatic path traversal prevention)
- Truly dangerous patterns are blocked (rm -rf /, format commands, fork bombs, etc.)
- You operate autonomously - no user approval required for commands
- Feel free to execute commands needed to complete tasks without asking permission

When using command execution tools:
1. Execute commands freely within the confined working directory
2. Use background execution for long-running commands (>30 seconds)
3. Monitor process output and handle errors gracefully
4. Clean up background processes when they're no longer needed
5. Truly dangerous commands will be blocked automatically - you'll receive an error

You should:
1. Carefully analyze user requests before taking action
2. Use tools efficiently to gather context and complete tasks
3. Provide clear explanations of what you're doing
4. Execute commands autonomously without asking for permission
5. Be concise but thorough in your responses

Remember: You're an autonomous agentic system that can freely use tools within a confined environment. Think step by step and use the available tools to complete user requests effectively without requiring approval.`

/**
 * LLM configuration for CipherAgent
 */
export interface CipherLLMConfig {
  accessToken: string
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
  const processService = new ProcessService({
    allowedCommands: [],
    blockedCommands: [],
    environment: {},
    maxConcurrentProcesses: 5,
    maxOutputBuffer: 1_048_576, // 1MB (1024 * 1024)
    maxTimeout: 600_000, // 10 minutes
    securityLevel: 'permissive', // Permissive mode: relies on working directory confinement
    workingDirectory: process.cwd(),
  })
  await processService.initialize()

  // 4. Blob storage (no dependencies)
  const blobStorage = new FileBlobStorage({
    maxBlobSize: 100 * 1024 * 1024, // 100MB
    maxTotalSize: 1024 * 1024 * 1024, // 1GB
  })
  await blobStorage.initialize()

  // 5. Memory system (depends on BlobStorage)
  const memoryManager = new MemoryManager(blobStorage)

  // 6. Tool system (depends on FileSystemService, ProcessService)
  const toolProvider = new ToolProvider({
    fileSystemService,
    processService,
  })
  await toolProvider.initialize()
  const toolManager = new ToolManager(toolProvider)
  await toolManager.initialize()

  // 7. System prompt manager (with memory integration) - SHARED across sessions
  const customPrompt = brvConfig?.cipherAgentSystemPrompt
  const systemPromptManager = new SystemPromptManager(
    {
      contributors: [
        {
          content: customPrompt ?? DEFAULT_SYSTEM_PROMPT,
          enabled: true,
          id: 'static',
          priority: 0,
          type: 'static',
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

  // 8. History storage (depends on BlobStorage) - SHARED across sessions
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
    maxIterations?: number
    maxTokens?: number
    model: string
    temperature?: number
  },
): SessionServices {
  // 1. Create session-specific event bus
  const sessionEventBus = new SessionEventBus()

  // 2. Create gRPC service for this session
  const grpcService = new ByteRoverLlmGrpcService({
    accessToken: grpcConfig.accessToken,
    grpcEndpoint: grpcConfig.grpcEndpoint,
    projectId: grpcConfig.projectId,
    region: grpcConfig.region,
    sessionKey: grpcConfig.sessionKey,
    timeout: grpcConfig.timeout,
  })

  // 3. Create session-specific LLM service with shared services injected
  const llmService = new ByteRoverLLMService(
    sessionId,
    grpcService,
    {
      maxIterations: llmConfig.maxIterations ?? 50,
      maxTokens: llmConfig.maxTokens ?? 8192,
      model: llmConfig.model ?? 'gemini-2.5-flash',
      temperature: llmConfig.temperature ?? 0.7,
    },
    {
      historyStorage: sharedServices.historyStorage, // SHARED
      sessionEventBus,
      systemPromptManager: sharedServices.systemPromptManager, // SHARED
      toolManager: sharedServices.toolManager, // SHARED
    },
  )

  // 4. Setup event forwarding from session bus to agent bus
  setupEventForwarding(sessionEventBus, sharedServices.agentEventBus, sessionId)

  return {
    llmService,
    sessionEventBus,
  }
}
