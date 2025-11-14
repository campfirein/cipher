import {GoogleGenAI} from '@google/genai'

import type {FileSystemConfig} from '../../core/domain/cipher/file-system/types.js'
import type {BrvConfig} from '../../core/domain/entities/brv-config.js'

import {AgentEventBus, SessionEventBus} from './events/event-emitter.js'
import {FileSystemService} from './file-system/file-system-service.js'
import {GeminiLLMService} from './llm/gemini-llm-service.js'
import {JsonMemoryStorage} from './memory/json-memory-storage.js'
import {MemoryManager} from './memory/memory-manager.js'
import {ProcessService} from './process/process-service.js'
import {setupEventForwarding} from './session/session-event-forwarder.js'
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
  apiKey: string
  fileSystemConfig?: Partial<FileSystemConfig>
  maxIterations?: number
  maxTokens?: number
  model?: string
  temperature?: number
}

/**
 * Services created by the factory
 */
export interface CipherServices {
  agentEventBus: AgentEventBus
  fileSystemService: FileSystemService
  llmService: GeminiLLMService
  memoryManager: MemoryManager
  processService: ProcessService
  sessionEventBus: SessionEventBus
  systemPromptManager: SystemPromptManager
  toolManager: ToolManager
  toolProvider: ToolProvider
}

/**
 * Creates all services needed for CipherAgent.
 * This follows the Dexto pattern of centralized service initialization.
 *
 * @param llmConfig - LLM configuration (API key, model settings)
 * @param brvConfig - Optional ByteRover config (for custom system prompt)
 * @returns Initialized services
 */
export async function createCipherServices(
  llmConfig: CipherLLMConfig,
  brvConfig?: BrvConfig,
): Promise<CipherServices> {
  // 1. Event buses (no dependencies)
  const agentEventBus = new AgentEventBus()
  const sessionEventBus = new SessionEventBus()

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

  // 4. Memory system (no dependencies)
  const memoryStorage = new JsonMemoryStorage()
  await memoryStorage.initialize()
  const memoryManager = new MemoryManager(memoryStorage)

  // 5. Tool system (depends on FileSystemService, ProcessService)
  const toolProvider = new ToolProvider({
    fileSystemService,
    processService,
  })
  await toolProvider.initialize()
  const toolManager = new ToolManager(toolProvider)
  await toolManager.initialize()

  // 6. System prompt manager (with memory integration)
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

  // 7. GoogleGenAI client
  const geminiClient = new GoogleGenAI({apiKey: llmConfig.apiKey})

  // 8. LLM service (depends on GoogleGenAI client, ToolManager, SystemPromptManager, SessionEventBus)
  const llmService = new GeminiLLMService(
    'cipher-agent-session',
    geminiClient,
    {
      apiKey: llmConfig.apiKey,
      maxIterations: llmConfig.maxIterations ?? 50,
      maxTokens: llmConfig.maxTokens ?? 8192,
      model: llmConfig.model ?? 'gemini-2.5-flash',
      temperature: llmConfig.temperature ?? 0.7,
    },
    {
      sessionEventBus,
      systemPromptManager,
      toolManager,
    },
  )

  // 9. Setup event forwarding from session bus to agent bus
  setupEventForwarding(sessionEventBus, agentEventBus, 'cipher-agent-session')

  return {
    agentEventBus,
    fileSystemService,
    llmService,
    memoryManager,
    processService,
    sessionEventBus,
    systemPromptManager,
    toolManager,
    toolProvider,
  }
}
