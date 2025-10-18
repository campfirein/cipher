/**
 * Unified Tool Manager
 *
 * Combines MCP tools and internal tools into a single interface for LLM services.
 * Handles tool routing, execution, and conflict resolution between different tool sources.
 */

import { logger } from '../../logger/index.js';
import { MCPManager } from '../../mcp/manager.js';
import { InternalToolManager } from './manager.js';
import { ToolExecutionResult } from '../../mcp/types.js';
import { isInternalToolName } from './types.js';
import { EventManager } from '../../events/event-manager.js';
import { SessionEvents } from '../../events/event-types.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Configuration for the unified tool manager
 */
export interface UnifiedToolManagerConfig {
	/**
	 * Whether to enable internal tools
	 * @default true
	 */
	enableInternalTools?: boolean;

	/**
	 * Whether to enable MCP tools
	 * @default true
	 */
	enableMcpTools?: boolean;

	/**
	 * How to handle tool name conflicts
	 * @default 'prefix-internal'
	 */
	conflictResolution?: 'prefix-internal' | 'prefer-internal' | 'prefer-mcp' | 'error';

	/**
	 * Timeout for tool execution in milliseconds
	 * @default 30000
	 */
	executionTimeout?: number;

	/**
	 * Operating mode - affects which tools are exposed
	 * - 'cli': Only search tools exposed to Cipher's LLM (background tools still executable)
	 * - 'default': Only ask_cipher tool exposed to external MCP clients
	 * - 'aggregator': All tools exposed to external MCP clients
	 * - 'api': Similar to CLI mode
	 * @default 'default'
	 */
	mode?: 'cli' | 'default' | 'aggregator' | 'api';
}

/**
 * Combined tool information for LLM services
 */
export interface CombinedToolSet {
	[toolName: string]: {
		description: string;
		parameters: any;
		source: 'internal' | 'mcp';
	};
}

/**
 * Unified Tool Manager that combines MCP and internal tools
 */
export class UnifiedToolManager {
	private mcpManager: MCPManager;
	private internalToolManager: InternalToolManager;
	private config: Required<UnifiedToolManagerConfig>;
	private eventManager?: EventManager;
	private toolsAlreadyLogged = false;
	private embeddingManager?: any; // Reference to embedding manager for status checking

	constructor(
		mcpManager: MCPManager,
		internalToolManager: InternalToolManager,
		config: UnifiedToolManagerConfig = {}
	) {
		this.mcpManager = mcpManager;
		this.internalToolManager = internalToolManager;
		this.config = {
			enableInternalTools: true,
			enableMcpTools: true,
			conflictResolution: 'prefix-internal',
			executionTimeout: 30000,
			mode: 'default',
			...config,
		};
	}

	/**
	 * Set the event manager for emitting tool execution events
	 */
	setEventManager(eventManager: EventManager): void {
		this.eventManager = eventManager;
	}

	/**
	 * Set the embedding manager for checking embedding status
	 */
	setEmbeddingManager(embeddingManager: any): void {
		this.embeddingManager = embeddingManager;
	}

	/**
	 * Check if embeddings are disabled globally
	 */
	private areEmbeddingsDisabled(): boolean {
		// Simple check: if embedding manager doesn't have available embeddings, disable tools
		if (this.embeddingManager) {
			return !this.embeddingManager.hasAvailableEmbeddings();
		}
		return true; // No embedding manager means embeddings disabled
	}

	/**
	 * Check if a tool is embedding-related and should be excluded when embeddings are disabled
	 */
	private isEmbeddingRelatedTool(toolName: string): boolean {
		const embeddingToolPatterns = [
			'extract_and_operate_memory',
			'search_memory',
			'search_reasoning',
			'store_reasoning_memory',
			'extract_reasoning_steps',
			'evaluate_reasoning',
			'memory_operation',
			'knowledge_search',
			'vector_search',
			'embedding',
			'similarity',
			'cipher_extract_and_operate_memory',
			'cipher_search_memory',
			'cipher_store_reasoning_memory',
			'cipher_extract_reasoning_steps',
			'cipher_evaluate_reasoning',
			'cipher_search_reasoning_patterns',
			// Workspace memory tools still need embeddings
			'cipher_workspace_search',
			'cipher_workspace_store',
			'workspace_search',
			'workspace_store',
		];

		return embeddingToolPatterns.some(pattern =>
			toolName.toLowerCase().includes(pattern.toLowerCase())
		);
	}

	/**
	 * Get all available tools from both sources
	 * Filters tools based on mode:
	 * - CLI mode: Only search tools + MCP tools (background tools excluded from agent access)
	 * - Default MCP mode: Only ask_cipher tool
	 * - Aggregator MCP mode: All tools
	 */
	async getAllTools(): Promise<CombinedToolSet> {
		if (!this.toolsAlreadyLogged && this.config.mode !== 'aggregator') {
			logger.debug('UnifiedToolManager: Getting all tools');
		}
		const combinedTools: CombinedToolSet = {};
		logger.debug('UnifiedToolManager: Tools config args', this.config);
		try {
			// MCP Default mode: Only expose ask_cipher tool
			if (this.config.mode === 'default') {
				// TODO: Add ask_cipher tool implementation
				combinedTools['ask_cipher'] = {
					description: 'Ask Cipher to perform tasks using its internal tools and capabilities',
					parameters: {
						type: 'object',
						properties: {
							query: {
								type: 'string',
								description: 'The task or question to ask Cipher',
							},
						},
						required: ['query'],
					},
					source: 'internal',
				};
				logger.debug('UnifiedToolManager: Default MCP mode - only ask_cipher tool exposed');
				return combinedTools;
			}

			// Get MCP tools if enabled (for CLI and aggregator modes)
			if (
				this.config.enableMcpTools &&
				(this.config.mode === 'cli' ||
					this.config.mode === 'aggregator' ||
					this.config.mode === 'api')
			) {
				if (!this.toolsAlreadyLogged && this.config.mode !== 'aggregator') {
					logger.debug('UnifiedToolManager: Loading MCP tools');
				}
				try {
					const mcpTools = await this.mcpManager.getAllTools();
					if (!this.toolsAlreadyLogged && this.config.mode !== 'aggregator') {
						logger.debug(`UnifiedToolManager: Retrieved ${Object.keys(mcpTools).length} MCP tools`);
					}
					for (const [toolName, tool] of Object.entries(mcpTools)) {
						combinedTools[toolName] = {
							description: tool.description,
							parameters: tool.parameters,
							source: 'mcp',
						};
					}
					if (!this.toolsAlreadyLogged && this.config.mode !== 'aggregator') {
						logger.debug(`UnifiedToolManager: Loaded ${Object.keys(mcpTools).length} MCP tools`);
					}
				} catch (error) {
					logger.warn('UnifiedToolManager: Failed to load MCP tools', { error });
				}
			}

			// Get internal tools if enabled
			if (this.config.enableInternalTools) {
				if (!this.toolsAlreadyLogged && this.config.mode !== 'aggregator') {
					logger.debug('UnifiedToolManager: Loading internal tools');
				}
				try {
					const internalTools = this.internalToolManager.getAllTools();
					if (!this.toolsAlreadyLogged && this.config.mode !== 'aggregator') {
						logger.debug(
							`UnifiedToolManager: Retrieved ${Object.keys(internalTools).length} internal tools`
						);
					}

					for (const [toolName, tool] of Object.entries(internalTools)) {
						// Check if embeddings are disabled and this is an embedding-related tool
						if (this.areEmbeddingsDisabled() && this.isEmbeddingRelatedTool(toolName)) {
							logger.debug(
								`UnifiedToolManager: Skipping embedding-related tool '${toolName}' - embeddings are disabled`
							);
							continue;
						}

						// Mode-specific tool filtering
						if (this.config.mode === 'cli') {
							// In CLI mode, only search-related tools are exposed to the agent.
							// Background tools are executed after the AI response and are not directly callable.
							const isAgentAccessible =
								(tool.agentAccessible ?? true) && // Default to true if not specified
								!toolName.includes('extract_and_operate_memory') &&
								!toolName.includes('store_reasoning');

							if (!isAgentAccessible) {
								continue;
							}
						} else if (this.config.mode === 'aggregator') {
							// Aggregator mode: Expose ALL tools (no filtering)
						} else {
							// Default/API modes: Skip background tools that are not agent-accessible
							if (tool.agentAccessible === false) {
								logger.debug(
									`UnifiedToolManager: Skipping internal-only tool '${toolName}' in ${
										this.config.mode
									} mode`
								);
								continue;
							}
						}

						const normalizedName = toolName.startsWith('cipher_') ? toolName : `cipher_${toolName}`;

						// Handle conflicts
						if (combinedTools[normalizedName]) {
							const conflictHandled = this.handleToolConflict(normalizedName, tool, combinedTools);
							if (!conflictHandled) continue;
						}

						combinedTools[normalizedName] = {
							description: tool.description,
							parameters: tool.parameters,
							source: 'internal',
						};
					}

					// Logging for different modes
					if (this.config.mode === 'cli') {
						const searchToolCount = Object.keys(combinedTools).filter(
							name =>
								combinedTools[name]?.source === 'internal' &&
								(name.includes('search') || name.includes('memory_') || name.includes('knowledge_'))
						).length;
						logger.debug(
							`UnifiedToolManager: CLI mode - ${searchToolCount} search tools accessible to LLM`
						);
					} else if (this.config.mode !== 'aggregator') {
						logger.debug(
							`UnifiedToolManager: Loaded ${Object.keys(internalTools).length} internal tools (${Object.keys(combinedTools).filter(name => combinedTools[name]?.source === 'internal').length} agent-accessible)`
						);
					}
				} catch (error) {
					logger.warn('UnifiedToolManager: Failed to load internal tools', { error });
				}
			}

			if (!this.toolsAlreadyLogged && this.config.mode !== 'aggregator') {
				logger.debug(
					`UnifiedToolManager: Combined tools loaded successfully (mode: ${this.config.mode})`
				);
				this.toolsAlreadyLogged = true;
			}
			return combinedTools;
		} catch (error) {
			logger.error('UnifiedToolManager: Failed to get all tools', { error });
			throw error;
		}
	}

	/**
	 * Execute a tool by routing to the appropriate manager
	 */
	async executeTool(toolName: string, args: any, sessionId?: string): Promise<ToolExecutionResult> {
		const executionId = uuidv4();
		const startTime = Date.now();
		const toolType =
			this.config.enableInternalTools && isInternalToolName(toolName) ? 'internal' : 'mcp';

		// Emit tool execution started event
		if (this.eventManager && sessionId) {
			logger.debug('UnifiedToolManager: Emitting tool execution started event', {
				toolName,
				toolType,
				sessionId,
				executionId,
				argsKeys: args ? Object.keys(args) : [],
				args: args,
			});

			this.eventManager.emitSessionEvent(sessionId, SessionEvents.TOOL_EXECUTION_STARTED, {
				toolName,
				toolType,
				sessionId,
				executionId,
				timestamp: startTime,
				args: args, // Include tool arguments
			});
		}

		try {
			logger.debug(`UnifiedToolManager: Executing tool '${toolName}'`, {
				toolName,
				hasArgs: !!args,
				sessionId,
				executionId,
			});

			let result: ToolExecutionResult;

			// Check if embeddings are disabled and this is an embedding-related tool
			if (this.areEmbeddingsDisabled() && this.isEmbeddingRelatedTool(toolName)) {
				logger.warn(
					`UnifiedToolManager: Blocking execution of embedding-related tool '${toolName}' - embeddings are disabled`
				);
				throw new Error(
					`Tool '${toolName}' is not available - embeddings are disabled for this session`
				);
			}

			// Determine which manager should handle this tool
			if (this.config.enableInternalTools && isInternalToolName(toolName)) {
				// Internal tool execution
				if (!this.internalToolManager.isInternalTool(toolName)) {
					throw new Error(`Internal tool '${toolName}' not found`);
				}

				logger.debug(`UnifiedToolManager: Routing '${toolName}' to internal tool manager`);
				result = await this.internalToolManager.executeTool(toolName, args);
			} else if (this.config.enableMcpTools) {
				// MCP tool execution
				logger.debug(`UnifiedToolManager: Routing '${toolName}' to MCP manager`);
				result = await this.mcpManager.executeTool(toolName, args);
			} else {
				throw new Error(`Tool '${toolName}' not available - no suitable manager enabled`);
			}

			// Emit tool execution completed event
			if (this.eventManager && sessionId) {
				this.eventManager.emitSessionEvent(sessionId, SessionEvents.TOOL_EXECUTION_COMPLETED, {
					toolName,
					toolType,
					sessionId,
					executionId,
					duration: Date.now() - startTime,
					success: true,
					result: result,
					timestamp: Date.now(),
				});
			}

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const duration = Date.now() - startTime;

			// Emit tool execution failed event
			if (this.eventManager && sessionId) {
				this.eventManager.emitSessionEvent(sessionId, SessionEvents.TOOL_EXECUTION_FAILED, {
					toolName,
					toolType,
					sessionId,
					executionId,
					error: errorMessage,
					duration,
					timestamp: Date.now(),
				});
			}

			logger.error(`UnifiedToolManager: Tool execution failed for '${toolName}'`, {
				toolName,
				error: errorMessage,
				sessionId,
				executionId,
				duration,
			});
			throw error;
		}
	}

	/**
	 * Execute a tool without triggering redundant tool loading (for background operations)
	 * This method bypasses the normal tool loading process when tools are already loaded
	 */
	async executeToolWithoutLoading(
		toolName: string,
		args: any,
		sessionId?: string
	): Promise<ToolExecutionResult> {
		const executionId = uuidv4();
		const startTime = Date.now();
		const toolType =
			this.config.enableInternalTools && isInternalToolName(toolName) ? 'internal' : 'mcp';

		// Emit tool execution started event
		if (this.eventManager && sessionId) {
			logger.debug('UnifiedToolManager: Emitting tool execution started event', {
				toolName,
				toolType,
				sessionId,
				executionId,
				argsKeys: args ? Object.keys(args) : [],
				args: args,
			});

			this.eventManager.emitSessionEvent(sessionId, SessionEvents.TOOL_EXECUTION_STARTED, {
				toolName,
				toolType,
				sessionId,
				executionId,
				timestamp: startTime,
				args: args, // Include tool arguments
			});
		}

		try {
			logger.debug(`UnifiedToolManager: Executing tool '${toolName}' (without loading)`, {
				toolName,
				hasArgs: !!args,
				sessionId,
				executionId,
			});

			let result: ToolExecutionResult;

			// Determine which manager should handle this tool
			if (this.config.enableInternalTools && isInternalToolName(toolName)) {
				// Internal tool execution
				if (!this.internalToolManager.isInternalTool(toolName)) {
					throw new Error(`Internal tool '${toolName}' not found`);
				}

				logger.debug(
					`UnifiedToolManager: Routing '${toolName}' to internal tool manager (without loading)`
				);
				result = await this.internalToolManager.executeTool(toolName, args);
			} else if (this.config.enableMcpTools) {
				// MCP tool execution
				logger.debug(`UnifiedToolManager: Routing '${toolName}' to MCP manager (without loading)`);
				result = await this.mcpManager.executeTool(toolName, args);
			} else {
				throw new Error(`Tool '${toolName}' not available - no suitable manager enabled`);
			}

			// Emit tool execution completed event
			if (this.eventManager && sessionId) {
				this.eventManager.emitSessionEvent(sessionId, SessionEvents.TOOL_EXECUTION_COMPLETED, {
					toolName,
					toolType,
					sessionId,
					executionId,
					duration: Date.now() - startTime,
					success: true,
					result: result,
					timestamp: Date.now(),
				});
			}

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const duration = Date.now() - startTime;

			// Emit tool execution failed event
			if (this.eventManager && sessionId) {
				this.eventManager.emitSessionEvent(sessionId, SessionEvents.TOOL_EXECUTION_FAILED, {
					toolName,
					toolType,
					sessionId,
					executionId,
					error: errorMessage,
					duration,
					timestamp: Date.now(),
				});
			}

			logger.error(
				`UnifiedToolManager: Tool execution failed for '${toolName}' (without loading)`,
				{
					toolName,
					error: errorMessage,
					sessionId,
					executionId,
					duration,
				}
			);
			throw error;
		}
	}

	/**
	 * Check if a background tool exists (for internal execution, not agent access)
	 */
	isBackgroundToolAvailable(toolName: string): boolean {
		try {
			if (this.config.enableInternalTools && isInternalToolName(toolName)) {
				const tool = this.internalToolManager.getTool(toolName);
				return !!tool;
			}
			return false;
		} catch {
			return false;
		}
	}

	/**
	 * Check if a tool is available (to agents) based on current mode
	 */
	async isToolAvailable(toolName: string): Promise<boolean> {
		try {
			// Default MCP mode: Only ask_cipher tool available
			if (this.config.mode === 'default') {
				return toolName === 'ask_cipher';
			}

			if (this.config.enableInternalTools && isInternalToolName(toolName)) {
				// Check if tool exists
				const tool = this.internalToolManager.getTool(toolName);
				if (!tool) return false;

				// Mode-specific availability
				if (this.config.mode === 'cli') {
					// CLI mode: Only search tools accessible to LLM
					const isSearchTool =
						toolName.includes('search') ||
						toolName.includes('memory_') ||
						toolName.includes('knowledge_') ||
						toolName.includes('vector_') ||
						toolName === 'extract_and_operate_memory' ||
						toolName === 'cipher_extract_and_operate_memory';

					return isSearchTool && tool.agentAccessible !== false;
				} else if (this.config.mode === 'aggregator') {
					// Aggregator mode: All tools available
					return true;
				} else {
					// API mode: Only agent-accessible tools
					return tool.agentAccessible !== false;
				}
			} else if (
				this.config.enableMcpTools &&
				(this.config.mode === 'cli' ||
					this.config.mode === 'aggregator' ||
					this.config.mode === 'api')
			) {
				const mcpTools = await this.mcpManager.getAllTools();
				return toolName in mcpTools;
			}
			return false;
		} catch (error) {
			logger.error(`UnifiedToolManager: Error checking tool availability for '${toolName}'`, {
				error,
			});
			return false;
		}
	}

	/**
	 * Get tool source (internal or mcp) for agent-accessible tools
	 */
	async getToolSource(toolName: string): Promise<'internal' | 'mcp' | null> {
		try {
			// Default MCP mode: Only ask_cipher tool
			if (this.config.mode === 'default') {
				return toolName === 'ask_cipher' ? 'internal' : null;
			}

			if (this.config.enableInternalTools && isInternalToolName(toolName)) {
				// Check if tool exists
				const tool = this.internalToolManager.getTool(toolName);
				if (!tool) return null;

				// Mode-specific source determination
				if (this.config.mode === 'cli') {
					// CLI mode: Only search tools accessible
					const isSearchTool =
						toolName.includes('search') ||
						toolName.includes('memory_') ||
						toolName.includes('knowledge_') ||
						toolName.includes('vector_') ||
						toolName === 'extract_and_operate_memory' ||
						toolName === 'cipher_extract_and_operate_memory';

					return isSearchTool && tool.agentAccessible !== false ? 'internal' : null;
				} else if (this.config.mode === 'aggregator') {
					// Aggregator mode: All tools available
					return 'internal';
				} else {
					// API mode: Only agent-accessible tools
					return tool.agentAccessible !== false ? 'internal' : null;
				}
			} else if (
				this.config.enableMcpTools &&
				(this.config.mode === 'cli' ||
					this.config.mode === 'aggregator' ||
					this.config.mode === 'api')
			) {
				const mcpTools = await this.mcpManager.getAllTools();
				return toolName in mcpTools ? 'mcp' : null;
			}
			return null;
		} catch (error) {
			logger.error(`UnifiedToolManager: Error determining tool source for '${toolName}'`, {
				error,
			});
			return null;
		}
	}

	/**
	 * Get tools formatted for specific LLM providers
	 */

	async getToolsForProvider(
		provider:
			| 'openai'
			| 'anthropic'
			| 'openrouter'
			| 'aws'
			| 'azure'
			| 'qwen'
			| 'gemini'
			| 'deepseek'
	): Promise<any[]> {
		logger.info(`UnifiedToolManager: Getting tools for provider: ${provider}`);
		const allTools = await this.getAllTools();
		logger.info(`UnifiedToolManager: Got ${Object.keys(allTools).length} total tools`);

		switch (provider) {
			case 'openai':
			case 'openrouter':
				logger.info('UnifiedToolManager: Formatting tools for OpenAI');
				return this.formatToolsForOpenAI(allTools);
			case 'qwen':
				return this.formatToolsForOpenAI(allTools);
			case 'gemini':
				logger.info('UnifiedToolManager: Formatting tools for Gemini');
				return this.formatToolsForGemini(allTools);
			case 'anthropic':
				logger.info('UnifiedToolManager: Formatting tools for Anthropic');
				return this.formatToolsForAnthropic(allTools);
			case 'aws':
				logger.info('UnifiedToolManager: Formatting tools for AWS (Anthropic-compatible)');
				return this.formatToolsForAnthropic(allTools); // AWS Bedrock uses Anthropic-compatible format
			case 'azure':
				logger.info('UnifiedToolManager: Formatting tools for Azure (OpenAI-compatible)');
				return this.formatToolsForOpenAI(allTools); // Azure OpenAI uses OpenAI-compatible format
			case 'deepseek':
				logger.info('UnifiedToolManager: Formatting tools for Deepseek');
				return this.formatToolsForOpenAI(allTools); // Deepseek uses OpenAI-compatible format
			default:
				throw new Error(`Unsupported provider: ${provider}`);
		}
	}

	/**
	 * Get manager statistics
	 */
	getStats(): {
		internalTools: any;
		mcpTools: any;
		config: Required<UnifiedToolManagerConfig>;
	} {
		return {
			internalTools: this.config.enableInternalTools
				? this.internalToolManager.getManagerStats()
				: null,
			mcpTools: this.config.enableMcpTools
				? {
						clientCount: this.mcpManager.getClients().size,
						failedConnections: Object.keys(this.mcpManager.getFailedConnections()).length,
					}
				: null,
			config: this.config,
		};
	}

	/**
	 * Handle tool name conflicts
	 */
	private handleToolConflict(
		toolName: string,
		_internalTool: any,
		_existingTools: CombinedToolSet
	): boolean {
		switch (this.config.conflictResolution) {
			case 'prefix-internal':
				// Tool already has cipher_ prefix, so conflict shouldn't occur
				return true;

			case 'prefer-internal':
				logger.warn(
					`UnifiedToolManager: Tool conflict for '${toolName}', preferring internal tool`
				);
				return true;

			case 'prefer-mcp':
				logger.warn(`UnifiedToolManager: Tool conflict for '${toolName}', preferring MCP tool`);
				return false;

			case 'error':
				throw new Error(`Tool name conflict: '${toolName}' exists in both MCP and internal tools`);

			default:
				return true;
		}
	}

	/**
	 * Format tools for OpenAI/OpenRouter (function calling format)
	 */
	private formatToolsForOpenAI(tools: CombinedToolSet): any[] {
		return Object.entries(tools).map(([name, tool]) => ({
			type: 'function',
			function: {
				name,
				description: tool.description,
				parameters: tool.parameters,
			},
		}));
	}

	/**
	 * Format tools for Anthropic (tool use format)
	 */
	private formatToolsForAnthropic(tools: CombinedToolSet): any[] {
		return Object.entries(tools).map(([name, tool]) => ({
			name,
			description: tool.description,
			input_schema: tool.parameters,
		}));
	}

	/**
	 * Format tools for Gemini (function calling format - same as OpenAI)
	 */
	private formatToolsForGemini(tools: CombinedToolSet): any[] {
		return Object.entries(tools).map(([name, tool]) => ({
			type: 'function',
			function: {
				name,
				description: tool.description,
				parameters: tool.parameters,
			},
		}));
	}
}
