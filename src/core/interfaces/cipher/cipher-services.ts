import type {AgentEventBus, SessionEventBus} from '../../../infra/cipher/events/event-emitter.js'
import type {FileSystemService} from '../../../infra/cipher/file-system/file-system-service.js'
import type {MemoryManager} from '../../../infra/cipher/memory/memory-manager.js'
import type {ProcessService} from '../../../infra/cipher/process/process-service.js'
import type {SimplePromptFactory} from '../../../infra/cipher/system-prompt/simple-prompt-factory.js'
import type {ToolManager} from '../../../infra/cipher/tools/tool-manager.js'
import type {ToolProvider} from '../../../infra/cipher/tools/tool-provider.js'
import type {IBlobStorage} from './i-blob-storage.js'
import type {ICodingAgentLogWatcher} from './i-coding-agent-log-watcher.js'
import type {IHistoryStorage} from './i-history-storage.js'
import type {ILLMService} from './i-llm-service.js'

/**
 * Shared services created at agent level and shared across all sessions.
 *
 * These services are singletons that provide global functionality:
 * - AgentEventBus: Global event bus for agent-level events
 * - ToolManager: Manages tool registration and execution (stateless)
 * - SimplePromptFactory: Builds system prompts from simple YAML templates
 * - FileSystemService: File system operations
 * - ProcessService: Command execution
 * - BlobStorage: Binary data storage
 * - HistoryStorage: Conversation history persistence
 * - MemoryManager: Agent memory system
 * - ToolProvider: Provides available tools
 * - CodingAgentLogWatcher: Watches coding agent logs for learning (optional)
 */
export interface CipherAgentServices {
  agentEventBus: AgentEventBus
  blobStorage: IBlobStorage
  codingAgentLogWatcher?: ICodingAgentLogWatcher
  fileSystemService: FileSystemService
  historyStorage: IHistoryStorage
  memoryManager: MemoryManager
  processService: ProcessService
  promptFactory: SimplePromptFactory
  toolManager: ToolManager
  toolProvider: ToolProvider
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
