import type {AgentEventBus, SessionEventBus} from '../../infra/events/event-emitter.js'
import type {FileSystemService} from '../../infra/file-system/file-system-service.js'
import type {CompactionService} from '../../infra/llm/context/compaction/compaction-service.js'
import type {AbstractGenerationQueue} from '../../infra/map/abstract-queue.js'
import type {MemoryManager} from '../../infra/memory/memory-manager.js'
import type {MemoryStore} from '../../infra/nclm/memory-store.js'
import type {ProcessService} from '../../infra/process/process-service.js'
import type {MessageStorageService} from '../../infra/storage/message-storage-service.js'
import type {SystemPromptManager} from '../../infra/system-prompt/system-prompt-manager.js'
import type {ToolManager} from '../../infra/tools/tool-manager.js'
import type {ToolProvider} from '../../infra/tools/tool-provider.js'
import type {IBlobStorage} from './i-blob-storage.js'
import type {IHistoryStorage} from './i-history-storage.js'
import type {ILLMService} from './i-llm-service.js'
import type {IPolicyEngine} from './i-policy-engine.js'
import type {ISandboxService} from './i-sandbox-service.js'
import type {IToolScheduler} from './i-tool-scheduler.js'

/**
 * Shared services created at agent level and shared across all sessions.
 *
 * These services are singletons that provide global functionality:
 * - AgentEventBus: Global event bus for agent-level events
 * - ToolManager: Manages tool registration and execution (stateless)
 * - ToolScheduler: Orchestrates tool execution with policy checks
 * - PolicyEngine: Rule-based ALLOW/DENY decisions for tools
 * - SystemPromptManager: Builds system prompts using contributor pattern
 * - FileSystemService: File system operations
 * - ProcessService: Command execution
 * - BlobStorage: Binary data storage
 * - HistoryStorage: Conversation history persistence
 * - MemoryManager: Agent memory system
 * - ToolProvider: Provides available tools
 */
export interface CipherAgentServices {
  /**
   * Background queue for generating L0/L1 abstract files (.abstract.md, .overview.md).
   * Generator is injected lazily via setGenerator() from rebindCurateTools().
   */
  abstractQueue: AbstractGenerationQueue
  agentEventBus: AgentEventBus
  blobStorage: IBlobStorage
  /**
   * CompactionService for context overflow management.
   */
  compactionService: CompactionService
  fileSystemService: FileSystemService
  historyStorage: IHistoryStorage
  memoryManager: MemoryManager
  /** NCLM working memory store — always-on, core part of the engine. */
  memoryStore: MemoryStore
  /**
   * MessageStorageService for direct granular message access.
   */
  messageStorageService: MessageStorageService
  policyEngine: IPolicyEngine
  processService: ProcessService
  sandboxService: ISandboxService
  systemPromptManager: SystemPromptManager
  toolManager: ToolManager
  toolProvider: ToolProvider
  toolScheduler: IToolScheduler
  /** Absolute path to the project working directory. */
  workingDirectory: string
}

/**
 * Session-specific services created per conversation session.
 *
 * These services are isolated per session to maintain conversation separation:
 * - SessionEventBus: Session-scoped event bus
 * - LLMService: LLM client with isolated context manager
 */
export interface SessionServices {
  llmService: ILLMService
  sessionEventBus: SessionEventBus
}

/**
 * Configuration for SessionManager
 */
export interface SessionManagerConfig {
  /**
   * Maximum number of concurrent sessions allowed.
   * Default: 100
   */
  maxSessions?: number

  /**
   * Session time-to-live in milliseconds.
   * Sessions inactive for longer than this will be cleaned up.
   * Default: 3600000 (1 hour)
   */
  sessionTTL?: number
}
