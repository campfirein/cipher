import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {AgentState, ICipherAgent} from '../../core/interfaces/cipher/i-cipher-agent.js'
import type {ILLMService} from '../../core/interfaces/i-llm-service.js'
import type {AgentEventBus, SessionEventBus} from '../events/event-emitter.js'
import type {FileSystemService} from '../file-system/file-system-service.js'
import type {SystemPromptManager} from '../system-prompt/system-prompt-manager.js'
import type {ToolManager} from '../tools/tool-manager.js'
import type {ToolProvider} from '../tools/tool-provider.js'
import type {CipherLLMConfig} from './agent-service-factory.js'

import {createCipherServices} from './agent-service-factory.js'
import {CipherAgentStateManager} from './cipher-agent-state-manager.js'

/**
 * CipherAgent - Main agent implementation
 *
 * Provides an agentic execution layer on top of the LLM service.
 * Uses service factory pattern for initialization (mirrors DextoAgent).
 *
 * Follows two-phase initialization:
 * 1. Constructor: validates and stores config
 * 2. start(): asynchronously creates all services
 *
 * Hardcoded defaults:
 * - LLM model: gemini-2.5-flash
 * - Temperature: 0.7
 * - Max tokens: 8192
 * - Max iterations: 50
 */
export class CipherAgent implements ICipherAgent {
  public readonly agentEventBus!: AgentEventBus
  private readonly _brvConfig?: BrvConfig
  private _isStarted: boolean = false
  private fileSystemService!: FileSystemService
  private readonly llmConfig: CipherLLMConfig
  private llmService!: ILLMService
  private readonly sessionEventBus!: SessionEventBus
  private readonly stateManager: CipherAgentStateManager
  private systemPromptManager!: SystemPromptManager
  private toolManager!: ToolManager
  private toolProvider!: ToolProvider

  /**
   * Creates a new CipherAgent instance
   * Does NOT initialize services - call start() for async initialization
   *
   * @param llmConfig - LLM configuration (API key, model settings)
   * @param brvConfig - Optional ByteRover config (for custom system prompt)
   */
  public constructor(llmConfig: CipherLLMConfig, brvConfig?: BrvConfig) {
    this.llmConfig = llmConfig
    this._brvConfig = brvConfig
    this.stateManager = new CipherAgentStateManager()
  }

  /**
   * Execute the agent with user input
   *
   * @param input - User input string
   * @returns Agent response from LLM
   * @throws Error if agent is not started
   */
  public async execute(input: string): Promise<string> {
    // Ensure agent is started
    this.ensureStarted()

    // Increment iteration counter
    const iteration = this.stateManager.incrementIteration()

    // Add execution record to history
    this.stateManager.addExecutionRecord(
      `[${new Date().toISOString()}] Iteration ${iteration}: ${input.slice(0, 100)}${input.length > 100 ? '...' : ''}`,
    )

    // Delegate to LLM service (which handles the agentic loop)
    // The GeminiLLMService will automatically:
    // 1. Add user message to context
    // 2. Build system prompt via SystemPromptManager
    // 3. Call LLM with available tools and system prompt
    // 4. Execute tool calls via ToolManager
    // 5. Loop until task completion or max iterations
    const response = await this.llmService.completeTask(input)

    return response
  }

  /**
   * Get current agent state
   *
   * @returns Current state information
   */
  public getState(): AgentState {
    return this.stateManager.getState()
  }

  /**
   * Get the current system prompt from SystemPromptManager
   * Useful for debugging and inspection
   *
   * @returns Current system prompt (built dynamically)
   */
  public async getSystemPrompt(): Promise<string> {
    this.ensureStarted()
    return this.systemPromptManager.build({})
  }

  /**
   * Reset the agent to initial state
   * Clears execution history and resets iteration counter
   */
  public reset(): void {
    this.stateManager.reset()

    // Emit conversation reset event
    this.agentEventBus.emit('cipher:conversationReset', {
      sessionId: 'cipher-agent-session',
    })
  }

  /**
   * Start the agent - initializes all services asynchronously
   * Must be called before execute()
   *
   * @throws Error if agent is already started
   */
  public async start(): Promise<void> {
    if (this._isStarted) {
      throw new Error('CipherAgent is already started')
    }

    // Create all services via factory
    const services = await createCipherServices(this.llmConfig, this._brvConfig)

    // Assign services using Object.assign for readonly properties
    Object.assign(this, services)

    this._isStarted = true
  }

  /**
   * Ensure the agent has been started
   *
   * @throws Error if agent is not started
   */
  private ensureStarted(): void {
    if (!this._isStarted) {
      throw new Error('CipherAgent must be started before use. Call start() first.')
    }
  }
}
