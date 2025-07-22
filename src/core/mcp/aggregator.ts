/**
 * AggregatorMCPManager implementation for the Model Context Protocol (MCP) aggregator mode.
 *
 * This file contains the AggregatorMCPManager class that extends MCPManager to provide
 * server-to-server aggregation capabilities, tool conflict resolution, and unified API exposure.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	ListResourcesRequestSchema,
	ReadResourceRequestSchema,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type {
	IAggregatorManager,
	AggregatorConfig,
	ToolRegistryEntry,
	ServerConfigs,
	ToolSet,
} from './types.js';

import { MCPManager } from './manager.js';
import { LOG_PREFIXES } from './constants.js';

/**
 * Implementation of the IAggregatorManager interface for MCP server aggregation.
 * Extends MCPManager to provide server-to-server connection capabilities.
 */
export class AggregatorMCPManager extends MCPManager implements IAggregatorManager {
	private server: Server | null = null;
	private config: AggregatorConfig | null = null;
	private toolRegistry = new Map<string, ToolRegistryEntry>();
	private conflictCount = 0;
	private startTime = 0;

	constructor() {
		super();
		this.logger.info(`${LOG_PREFIXES.MANAGER} AggregatorMCPManager initialized`);
	}

	/**
	 * Start the aggregator server and connect to downstream servers.
	 */
	async startServer(config: AggregatorConfig): Promise<void> {
		this.config = config;
		this.startTime = Date.now();

		this.logger.info(`${LOG_PREFIXES.MANAGER} Starting aggregator server`, {
			transport: 'stdio',
			serverCount: Object.keys(config.servers).length,
		});

		// Initialize connections to downstream servers
		await this.initializeFromConfig(config.servers);

		// Create MCP server instance
		this.server = new Server(
			{
				name: 'cipher-aggregator',
				version: '1.0.0',
			},
			{
				capabilities: {
					tools: {},
					prompts: {},
					resources: {},
				},
			}
		);

		// Register aggregated tools
		await this._registerAggregatedTools();

		// Register aggregated prompts
		await this._registerAggregatedPrompts();

		// Register aggregated resources
		await this._registerAggregatedResources();

		// Start the server transport
		await this._startServerTransport(config);

		this.logger.info(`${LOG_PREFIXES.MANAGER} Aggregator server started successfully`, {
			toolCount: this.toolRegistry.size,
			conflicts: this.conflictCount,
		});
	}

	/**
	 * Stop the aggregator server and disconnect from all downstream servers.
	 */
	async stopServer(): Promise<void> {
		this.logger.info(`${LOG_PREFIXES.MANAGER} Stopping aggregator server`);

		if (this.server) {
			await this.server.close();
			this.server = null;
		}

		await this.disconnectAll();
		this.toolRegistry.clear();
		this.conflictCount = 0;
		this.config = null;

		this.logger.info(`${LOG_PREFIXES.MANAGER} Aggregator server stopped`);
	}

	/**
	 * Get the aggregated tool registry.
	 */
	getToolRegistry(): Map<string, ToolRegistryEntry> {
		return new Map(this.toolRegistry);
	}

	/**
	 * Discover available MCP servers in the network.
	 */
	async discoverServers(): Promise<ServerConfigs> {
		// TODO: Implement network discovery
		// For now, return empty config as discovery is not implemented
		this.logger.info(`${LOG_PREFIXES.MANAGER} Server discovery not yet implemented`);
		return {};
	}

	/**
	 * Get aggregator statistics.
	 */
	getStats(): {
		connectedServers: number;
		totalTools: number;
		totalPrompts: number;
		totalResources: number;
		conflicts: number;
		uptime: number;
	} {
		return {
			connectedServers: this.getClients().size,
			totalTools: this.toolRegistry.size,
			totalPrompts: 0, // TODO: Implement prompt counting
			totalResources: 0, // TODO: Implement resource counting
			conflicts: this.conflictCount,
			uptime: this.startTime ? Date.now() - this.startTime : 0,
		};
	}

	/**
	 * Override getAllTools to use conflict resolution strategy.
	 */
	override async getAllTools(): Promise<ToolSet> {
		const allTools: ToolSet = {};
		const errors: string[] = [];

		// Clear and rebuild registry
		this.toolRegistry.clear();
		this.conflictCount = 0;

		// Process clients in parallel
		const toolPromises = Array.from(this.getClients().entries()).map(async ([name, client]) => {
			try {
				const tools = await client.getTools();

				// Process each tool with conflict resolution
				Object.entries(tools).forEach(([toolName, toolDef]) => {
					const resolvedName = this._resolveToolNameConflict(toolName, name, toolDef);
					allTools[resolvedName] = toolDef;

					// Update registry
					this.toolRegistry.set(resolvedName, {
						tool: toolDef,
						clientName: name,
						originalName: toolName,
						registeredName: resolvedName,
						timestamp: Date.now(),
					});
				});

				this.logger.debug(
					`${LOG_PREFIXES.MANAGER} Retrieved ${Object.keys(tools).length} tools from ${name}`,
					{ clientName: name, toolCount: Object.keys(tools).length }
				);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				errors.push(`${name}: ${errorMessage}`);

				this.logger.error(`${LOG_PREFIXES.MANAGER} Failed to get tools from ${name}`, {
					clientName: name,
					error: errorMessage,
				});
			}
		});

		await Promise.allSettled(toolPromises);

		if (errors.length > 0 && Object.keys(allTools).length === 0) {
			throw new Error(`Failed to retrieve tools from all clients: ${errors.join('; ')}`);
		}

		this.logger.info(
			`${LOG_PREFIXES.MANAGER} Retrieved ${Object.keys(allTools).length} total tools with ${this.conflictCount} conflicts resolved`,
			{
				toolCount: Object.keys(allTools).length,
				clientCount: this.getClients().size,
				conflicts: this.conflictCount,
			}
		);

		return allTools;
	}

	// ======================================================
	// Private Methods
	// ======================================================

	/**
	 * Resolve tool name conflicts based on configuration strategy.
	 */
	private _resolveToolNameConflict(toolName: string, clientName: string, _toolDef: any): string {
		const strategy = this.config?.conflictResolution || 'prefix';

		// Check if tool already exists
		const existingEntry = Array.from(this.toolRegistry.values()).find(
			entry => entry.originalName === toolName
		);

		if (!existingEntry) {
			// No conflict, use original name
			return toolName;
		}

		// Handle conflict based on strategy
		switch (strategy) {
			case 'first-wins': {
				this.logger.warn(
					`${LOG_PREFIXES.MANAGER} Tool name conflict: ${toolName} already exists, skipping from ${clientName}`,
					{ toolName, clientName, strategy }
				);
				this.conflictCount++;
				return `${clientName}__conflict__${toolName}__${Date.now()}`;
			}

			case 'error': {
				this.conflictCount++;
				const errorMsg = `Tool name conflict: ${toolName} exists in both ${existingEntry.clientName} and ${clientName}`;
				this.logger.error(`${LOG_PREFIXES.MANAGER} ${errorMsg}`, {
					toolName,
					clientName,
					strategy,
				});
				throw new Error(errorMsg);
			}

			case 'prefix':
			default: {
				this.conflictCount++;
				const prefixedName = `${clientName}.${toolName}`;
				this.logger.info(
					`${LOG_PREFIXES.MANAGER} Tool name conflict resolved: ${toolName} -> ${prefixedName}`,
					{ toolName, clientName, resolvedName: prefixedName, strategy }
				);
				return prefixedName;
			}
		}
	}

	/**
	 * Register all aggregated tools with the MCP server.
	 */
	private async _registerAggregatedTools(): Promise<void> {
		if (!this.server) {
			throw new Error('Server not initialized');
		}

		const tools = await this.getAllTools();

		// Register list tools handler
		this.server.setRequestHandler(ListToolsRequestSchema, async () => {
			const currentTools = await this.getAllTools();
			const toolList = Object.entries(currentTools).map(([name, tool]) => ({
				name,
				description: tool.description,
				inputSchema: tool.parameters,
			}));
			return { tools: toolList };
		});

		// Register call tool handler
		this.server.setRequestHandler(CallToolRequestSchema, async request => {
			const { name, arguments: args } = request.params;
			return await this.executeTool(name, args || {});
		});

		this.logger.info(
			`${LOG_PREFIXES.MANAGER} Registered ${Object.keys(tools).length} aggregated tools`
		);
	}

	/**
	 * Register all aggregated prompts with the MCP server.
	 */
	private async _registerAggregatedPrompts(): Promise<void> {
		if (!this.server) {
			throw new Error('Server not initialized');
		}

		const prompts = await this.listAllPrompts();

		// Register prompt handlers
		this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
			return {
				prompts: prompts.map(name => ({
					name,
					description: `Aggregated prompt: ${name}`,
				})),
			};
		});

		this.server.setRequestHandler(GetPromptRequestSchema, async request => {
			const { name, arguments: args } = request.params;
			return await this.getPrompt(name, args);
		});

		this.logger.info(`${LOG_PREFIXES.MANAGER} Registered ${prompts.length} aggregated prompts`);
	}

	/**
	 * Register all aggregated resources with the MCP server.
	 */
	private async _registerAggregatedResources(): Promise<void> {
		if (!this.server) {
			throw new Error('Server not initialized');
		}

		const resources = await this.listAllResources();

		// Register resource handlers
		this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
			return {
				resources: resources.map(uri => ({
					uri,
					name: uri.split('/').pop() || uri,
					description: `Aggregated resource: ${uri}`,
				})),
			};
		});

		this.server.setRequestHandler(ReadResourceRequestSchema, async request => {
			const { uri } = request.params;
			return await this.readResource(uri);
		});

		this.logger.info(`${LOG_PREFIXES.MANAGER} Registered ${resources.length} aggregated resources`);
	}

	/**
	 * Start the server transport based on configuration.
	 */
	private async _startServerTransport(_config: AggregatorConfig): Promise<void> {
		if (!this.server) {
			throw new Error('Server not initialized');
		}

		// For now, only support stdio transport for the aggregator server
		// TODO: Add HTTP/SSE transport support
		const transport = new StdioServerTransport();
		await this.server.connect(transport);

		this.logger.info(`${LOG_PREFIXES.MANAGER} Aggregator server transport started (stdio)`);
	}
}
