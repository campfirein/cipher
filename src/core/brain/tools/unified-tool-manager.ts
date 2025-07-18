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
			...config,
		};
	}

	/**
	 * Get all available tools from both sources
	 */
	async getAllTools(): Promise<CombinedToolSet> {
		const combinedTools: CombinedToolSet = {};

		try {
			// Get MCP tools if enabled
			if (this.config.enableMcpTools) {
				try {
					const mcpTools = await this.mcpManager.getAllTools();
					for (const [toolName, tool] of Object.entries(mcpTools)) {
						combinedTools[toolName] = {
							description: tool.description,
							parameters: tool.parameters,
							source: 'mcp',
						};
					}
					logger.debug(`UnifiedToolManager: Loaded ${Object.keys(mcpTools).length} MCP tools`);
				} catch (error) {
					logger.warn('UnifiedToolManager: Failed to load MCP tools', { error });
				}
			}

			// Get internal tools if enabled
			if (this.config.enableInternalTools) {
				try {
					const internalTools = this.internalToolManager.getAllTools();
					for (const [toolName, tool] of Object.entries(internalTools)) {
						// Skip tools that are not agent-accessible (internal-only tools)
						if (tool.agentAccessible === false) {
							logger.debug(`UnifiedToolManager: Skipping internal-only tool '${toolName}'`);
							continue;
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
					const totalInternalTools = Object.keys(internalTools).length;
					const agentAccessibleTools = Object.values(internalTools).filter(
						tool => tool.agentAccessible !== false
					).length;
					logger.debug(
						`UnifiedToolManager: Loaded ${totalInternalTools} internal tools (${agentAccessibleTools} agent-accessible, ${totalInternalTools - agentAccessibleTools} internal-only)`
					);
				} catch (error) {
					logger.warn('UnifiedToolManager: Failed to load internal tools', { error });
				}
			}

			logger.info('UnifiedToolManager: Combined tools loaded successfully', {
				totalTools: Object.keys(combinedTools).length,
				mcpTools: Object.values(combinedTools).filter(t => t.source === 'mcp').length,
				internalTools: Object.values(combinedTools).filter(t => t.source === 'internal').length,
			});

			return combinedTools;
		} catch (error) {
			logger.error('UnifiedToolManager: Failed to load combined tools', { error });
			throw error;
		}
	}

	/**
	 * Execute a tool by routing to the appropriate manager
	 */
	async executeTool(toolName: string, args: any): Promise<ToolExecutionResult> {
		try {
			logger.debug(`UnifiedToolManager: Executing tool '${toolName}'`, {
				toolName,
				hasArgs: !!args,
			});

			// Determine which manager should handle this tool
			if (this.config.enableInternalTools && isInternalToolName(toolName)) {
				// Internal tool execution
				if (!this.internalToolManager.isInternalTool(toolName)) {
					throw new Error(`Internal tool '${toolName}' not found`);
				}

				logger.debug(`UnifiedToolManager: Routing '${toolName}' to internal tool manager`);
				return await this.internalToolManager.executeTool(toolName, args);
			} else if (this.config.enableMcpTools) {
				// MCP tool execution
				logger.debug(`UnifiedToolManager: Routing '${toolName}' to MCP manager`);
				return await this.mcpManager.executeTool(toolName, args);
			} else {
				throw new Error(`Tool '${toolName}' not available - no suitable manager enabled`);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(`UnifiedToolManager: Tool execution failed for '${toolName}'`, {
				toolName,
				error: errorMessage,
			});
			throw error;
		}
	}

	/**
	 * Check if a tool is available (to agents)
	 */
	async isToolAvailable(toolName: string): Promise<boolean> {
		try {
			if (this.config.enableInternalTools && isInternalToolName(toolName)) {
				// Check if tool exists and is agent-accessible
				const tool = this.internalToolManager.getTool(toolName);
				if (!tool) return false;

				// Skip tools that are not agent-accessible (internal-only tools)
				if (tool.agentAccessible === false) {
					return false;
				}

				return true;
			} else if (this.config.enableMcpTools) {
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
			if (this.config.enableInternalTools && isInternalToolName(toolName)) {
				// Check if tool exists and is agent-accessible
				const tool = this.internalToolManager.getTool(toolName);
				if (!tool) return null;

				// Skip tools that are not agent-accessible (internal-only tools)
				if (tool.agentAccessible === false) {
					return null;
				}

				return 'internal';
			} else if (this.config.enableMcpTools) {
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
	async getToolsForProvider(provider: 'openai' | 'anthropic' | 'openrouter' | 'gemini'): Promise<any[]> {
		const allTools = await this.getAllTools();

		switch (provider) {
			case 'openai':
			case 'openrouter':
				return this.formatToolsForOpenAI(allTools);
			case 'anthropic':
				return this.formatToolsForAnthropic(allTools);
			case 'gemini':
				return this.formatToolsForGemini(allTools);
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
		internalTool: any,
		existingTools: CombinedToolSet
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
	 * Format tools for Gemini (function calling format)
	 */
	private formatToolsForGemini(tools: CombinedToolSet): any[] {
		const functionDeclarations = Object.entries(tools).map(([name, tool]) => ({
			name,
			description: tool.description,
			parameters: tool.parameters,
		}));
		
		return [{
			functionDeclarations
		}];
	}
}
