import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {FileSystemConfig} from '../../core/domain/file-system/types.js'

import {FileSystemService} from '../file-system/file-system-service.js'
import {GeminiLLMService} from '../llm/gemini-llm-service.js'
import {SystemPromptManager} from '../system-prompt/system-prompt-manager.js'
import {ToolManager} from '../tools/tool-manager.js'
import {ToolProvider} from '../tools/tool-provider.js'

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

You should:
1. Carefully analyze user requests before taking action
2. Use tools efficiently to gather context and complete tasks
3. Provide clear explanations of what you're doing
4. Ask for clarification when requirements are ambiguous
5. Be concise but thorough in your responses

Remember: You're an agentic system that can autonomously use tools to accomplish tasks. Think step by step and use the available tools to complete user requests effectively.`

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
  fileSystemService: FileSystemService
  llmService: GeminiLLMService
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
  // 1. File system service (no dependencies)
  const fileSystemService = new FileSystemService(llmConfig.fileSystemConfig)
  await fileSystemService.initialize()

  // 2. Tool system (depends on FileSystemService)
  const toolProvider = new ToolProvider({fileSystemService})
  await toolProvider.initialize()
  const toolManager = new ToolManager(toolProvider)
  await toolManager.initialize()

  // 3. System prompt manager
  const customPrompt = brvConfig?.cipherAgentSystemPrompt
  const systemPromptManager = new SystemPromptManager({
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
    ],
  })

  // 4. LLM service (depends on ToolManager and SystemPromptManager)
  const llmService = new GeminiLLMService(
    'cipher-agent-session',
    {
      apiKey: llmConfig.apiKey,
      maxIterations: llmConfig.maxIterations ?? 50,
      maxTokens: llmConfig.maxTokens ?? 8192,
      model: llmConfig.model ?? 'gemini-2.5-flash',
      temperature: llmConfig.temperature ?? 0.7,
    },
    toolManager,
    systemPromptManager,
  )

  return {
    fileSystemService,
    llmService,
    systemPromptManager,
    toolManager,
    toolProvider,
  }
}
