/**
 * MCPManager implementation for the Model Context Protocol (MCP) module.
 *
 * This file contains the MCPManager class that orchestrates multiple MCP clients,
 * provides caching for O(1) lookups, and handles connection strategies.
 */

import { GetPromptResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

import type {
	IMCPManager,
	IMCPClient,
	ServerConfigs,
	McpServerConfig,
	ToolSet,
	ToolExecutionResult,
} from './types.js';

import { ERROR_MESSAGES, LOG_PREFIXES, CONNECTION_MODES } from './constants.js';

import { MCPClient } from './client.js';
import { Logger, createLogger } from '../logger/index.js';
import { EventManager } from '../events/event-manager.js';
import { ServiceEvents } from '../events/event-types.js';

/**
 * Cache entry for tools, prompts, and resources.
 */
interface CacheEntry<T> {
	data: T;
	timestamp: number;
	clientName: string;
}

/**
 * Registry entry for tracking client metadata.
 */
interface ClientRegistryEntry {
	client: IMCPClient;
	config: McpServerConfig;
	connected: boolean;
	lastSeen: number;
	failureCount: number;
}

/**
 * Implementation of the IMCPManager interface for orchestrating multiple MCP clients.
 * Provides O(1) cached lookups, connection management, and error handling strategies.
 */
export class MCPManager implements IMCPManager {
	private clients = new Map<string, ClientRegistryEntry>();
	private failedConnections: Record<string, string> = {};
	protected logger: Logger;
	private eventManager?: EventManager;
	private quietMode = false;

	// O(1) lookup caches
	private toolCache = new Map<string, CacheEntry<any>>();
	private toolClientMap = new Map<string, string>(); // toolName -> clientName
	private promptCache = new Map<string, CacheEntry<string[]>>();
	private promptClientMap = new Map<string, string>(); // promptName -> clientName
	private resourceCache = new Map<string, CacheEntry<string[]>>();
	private resourceClientMap = new Map<string, string>(); // resourceUri -> clientName

	// Cache configuration
	private cacheTimeout = 5 * 60 * 1000; // 5 minutes
	private maxCacheSize = 1000;

	constructor() {
		this.logger = createLogger({ level: 'info' });
		// Note: quiet mode can be set after construction, so this initial log may still appear
		this.logger.info(`${LOG_PREFIXES.MANAGER} MCPManager initialized`);
	}

	/**
	 * Set the event manager for emitting connection lifecycle events
	 */
	setEventManager(eventManager: EventManager): void {
		this.eventManager = eventManager;
	}

	/**
	 * Enable quiet mode to reduce logging verbosity (useful for CLI mode)
	 */
	setQuietMode(quiet: boolean): void {
		this.quietMode = quiet;
	}

	/**
	 * Register a client with the manager.
	 */
	registerClient(name: string, client: IMCPClient): void {
		if (this.clients.has(name)) {
			this.logger.warn(
				`${LOG_PREFIXES.MANAGER} ${ERROR_MESSAGES.CLIENT_ALREADY_REGISTERED}: ${name}`,
				{ clientName: name }
			);
			return;
		}

		this.clients.set(name, {
			client,
			config: {} as McpServerConfig, // Will be set during connection
			connected: false,
			lastSeen: Date.now(),
			failureCount: 0,
		});

		this.logger.info(`${LOG_PREFIXES.MANAGER} Registered client: ${name}`, {
			clientName: name,
			totalClients: this.clients.size,
		});
	}

	/**
	 * Get all available tools from all connected clients.
	 */
	async getAllTools(): Promise<ToolSet> {
		const allTools: ToolSet = {};
		const errors: string[] = [];

		// Process clients in parallel for better performance
		const toolPromises = Array.from(this.clients.entries()).map(async ([name, entry]) => {
			if (!entry.connected) {
				return;
			}

			try {
				const tools = await entry.client.getTools();

				// Merge tools and update cache
				Object.entries(tools).forEach(([toolName, toolDef]) => {
					// Handle tool name conflicts by prefixing with client name
					const finalToolName = allTools[toolName] ? `${name}.${toolName}` : toolName;
					allTools[finalToolName] = toolDef;

					// Update O(1) lookup cache
					this.toolClientMap.set(finalToolName, name);
					this.toolCache.set(finalToolName, {
						data: toolDef,
						timestamp: Date.now(),
						clientName: name,
					});
				});

				this.logger.debug(
					`${LOG_PREFIXES.MANAGER} Retrieved ${Object.keys(tools).length} tools from ${name}`,
					{ clientName: name, toolCount: Object.keys(tools).length }
				);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				errors.push(`${name}: ${errorMessage}`);
				this._updateClientFailure(name);

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

		this._cleanupCache(this.toolCache);

		this.logger.debug(
			`${LOG_PREFIXES.MANAGER} Retrieved ${Object.keys(allTools).length} total tools`,
			{ toolCount: Object.keys(allTools).length, clientCount: this.clients.size }
		);

		return allTools;
	}

	/**
	 * Get the client that provides a specific tool.
	 */
	getToolClient(toolName: string): IMCPClient | undefined {
		const clientName = this.toolClientMap.get(toolName);
		if (!clientName) {
			return undefined;
		}

		const entry = this.clients.get(clientName);
		return entry?.connected ? entry.client : undefined;
	}

	/**
	 * Execute a tool with the given name and arguments.
	 */
	async executeTool(toolName: string, args: any): Promise<ToolExecutionResult> {
		const client = this.getToolClient(toolName);

		if (!client) {
			// Try to find the tool by refreshing cache
			await this._refreshToolCache();
			const refreshedClient = this.getToolClient(toolName);

			if (!refreshedClient) {
				throw new Error(`${ERROR_MESSAGES.NO_CLIENT_FOR_TOOL}: ${toolName}`);
			}

			return refreshedClient.callTool(toolName, args);
		}

		this.logger.info(`${LOG_PREFIXES.MANAGER} Executing tool: ${toolName}`, {
			toolName,
			hasArgs: !!args,
		});

		try {
			const result = await client.callTool(toolName, args);

			this.logger.info(`${LOG_PREFIXES.MANAGER} Tool executed successfully: ${toolName}`, {
				toolName,
			});

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logger.error(`${LOG_PREFIXES.MANAGER} Tool execution failed: ${toolName}`, {
				toolName,
				error: errorMessage,
			});
			throw error;
		}
	}

	/**
	 * List all available prompts from all connected clients.
	 */
	async listAllPrompts(): Promise<string[]> {
		const allPrompts = new Set<string>();
		const errors: string[] = [];

		const promptPromises = Array.from(this.clients.entries()).map(async ([name, entry]) => {
			if (!entry.connected) {
				return;
			}

			try {
				const prompts = await entry.client.listPrompts();

				prompts.forEach(promptName => {
					// Handle prompt name conflicts by prefixing with client name
					const finalPromptName = allPrompts.has(promptName) ? `${name}.${promptName}` : promptName;
					allPrompts.add(finalPromptName);

					// Update O(1) lookup cache
					this.promptClientMap.set(finalPromptName, name);
				});

				if (prompts.length > 0) {
					this.logger.debug(
						`${LOG_PREFIXES.MANAGER} Retrieved ${prompts.length} prompts from ${name}`,
						{ clientName: name, promptCount: prompts.length }
					);
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				errors.push(`${name}: ${errorMessage}`);
				this._updateClientFailure(name);

				this.logger.error(`${LOG_PREFIXES.MANAGER} Failed to list prompts from ${name}`, {
					clientName: name,
					error: errorMessage,
				});
			}
		});

		await Promise.allSettled(promptPromises);

		const promptList = Array.from(allPrompts);

		if (!this.quietMode) {
			this.logger.info(`${LOG_PREFIXES.MANAGER} Retrieved ${promptList.length} total prompts`, {
				promptCount: promptList.length,
				clientCount: this.clients.size,
			});
		}

		return promptList;
	}

	/**
	 * Get the client that provides a specific prompt.
	 */
	getPromptClient(promptName: string): IMCPClient | undefined {
		const clientName = this.promptClientMap.get(promptName);
		if (!clientName) {
			return undefined;
		}

		const entry = this.clients.get(clientName);
		return entry?.connected ? entry.client : undefined;
	}

	/**
	 * Get a prompt by name.
	 */
	async getPrompt(name: string, args?: any): Promise<GetPromptResult> {
		const client = this.getPromptClient(name);

		if (!client) {
			// Try to find the prompt by refreshing cache
			await this._refreshPromptCache();
			const refreshedClient = this.getPromptClient(name);

			if (!refreshedClient) {
				throw new Error(`${ERROR_MESSAGES.NO_CLIENT_FOR_PROMPT}: ${name}`);
			}

			return refreshedClient.getPrompt(name, args);
		}

		this.logger.info(`${LOG_PREFIXES.MANAGER} Getting prompt: ${name}`, {
			promptName: name,
			hasArgs: !!args,
		});

		try {
			const result = await client.getPrompt(name, args);

			this.logger.info(`${LOG_PREFIXES.MANAGER} Prompt retrieved successfully: ${name}`, {
				promptName: name,
			});

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logger.error(`${LOG_PREFIXES.MANAGER} Failed to get prompt: ${name}`, {
				promptName: name,
				error: errorMessage,
			});
			throw error;
		}
	}

	/**
	 * List all available resources from all connected clients.
	 */
	async listAllResources(): Promise<string[]> {
		const allResources = new Set<string>();
		const errors: string[] = [];

		const resourcePromises = Array.from(this.clients.entries()).map(async ([name, entry]) => {
			if (!entry.connected) {
				return;
			}

			try {
				const resources = await entry.client.listResources();

				resources.forEach(resourceUri => {
					allResources.add(resourceUri);

					// Update O(1) lookup cache
					this.resourceClientMap.set(resourceUri, name);
				});

				if (resources.length > 0) {
					this.logger.debug(
						`${LOG_PREFIXES.MANAGER} Retrieved ${resources.length} resources from ${name}`,
						{ clientName: name, resourceCount: resources.length }
					);
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				errors.push(`${name}: ${errorMessage}`);
				this._updateClientFailure(name);

				this.logger.error(`${LOG_PREFIXES.MANAGER} Failed to list resources from ${name}`, {
					clientName: name,
					error: errorMessage,
				});
			}
		});

		await Promise.allSettled(resourcePromises);

		const resourceList = Array.from(allResources);

		if (!this.quietMode) {
			this.logger.info(`${LOG_PREFIXES.MANAGER} Retrieved ${resourceList.length} total resources`, {
				resourceCount: resourceList.length,
				clientCount: this.clients.size,
			});
		}

		return resourceList;
	}

	/**
	 * Get the client that provides a specific resource.
	 */
	getResourceClient(resourceUri: string): IMCPClient | undefined {
		const clientName = this.resourceClientMap.get(resourceUri);
		if (!clientName) {
			return undefined;
		}

		const entry = this.clients.get(clientName);
		return entry?.connected ? entry.client : undefined;
	}

	/**
	 * Read a resource by URI.
	 */
	async readResource(uri: string): Promise<ReadResourceResult> {
		const client = this.getResourceClient(uri);

		if (!client) {
			// Try to find the resource by refreshing cache
			await this._refreshResourceCache();
			const refreshedClient = this.getResourceClient(uri);

			if (!refreshedClient) {
				throw new Error(`${ERROR_MESSAGES.NO_CLIENT_FOR_RESOURCE}: ${uri}`);
			}

			return refreshedClient.readResource(uri);
		}

		this.logger.info(`${LOG_PREFIXES.MANAGER} Reading resource: ${uri}`, { resourceUri: uri });

		try {
			const result = await client.readResource(uri);

			this.logger.info(`${LOG_PREFIXES.MANAGER} Resource read successfully: ${uri}`, {
				resourceUri: uri,
			});

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logger.error(`${LOG_PREFIXES.MANAGER} Failed to read resource: ${uri}`, {
				resourceUri: uri,
				error: errorMessage,
			});
			throw error;
		}
	}

	/**
	 * Initialize clients from server configurations.
	 */
	async initializeFromConfig(serverConfigs: ServerConfigs): Promise<void> {
		const enabledServers = Object.entries(serverConfigs).filter(
			([, config]) => config.enabled !== false
		);
		if (!this.quietMode) {
			this.logger.info(
				`${LOG_PREFIXES.MANAGER} Initializing ${enabledServers.length} servers (${Object.keys(serverConfigs).length - enabledServers.length} disabled)`,
				{
					enabledServerCount: enabledServers.length,
					totalServerCount: Object.keys(serverConfigs).length,
					disabledServerCount: Object.keys(serverConfigs).length - enabledServers.length,
				}
			);
		}

		const strictServers: string[] = [];
		const connectionPromises: Promise<void>[] = [];

		// Process all server configurations
		for (const [name, config] of Object.entries(serverConfigs)) {
			// Skip disabled servers
			if (config.enabled === false) {
				this.logger.info(`${LOG_PREFIXES.MANAGER} Skipping disabled server: ${name}`, {
					serverName: name,
				});
				continue;
			}

			if (config.connectionMode === CONNECTION_MODES.STRICT) {
				strictServers.push(name);
			}

			const connectionPromise = this.connectServer(name, config);
			connectionPromises.push(connectionPromise);
		}

		// Wait for all connections to complete
		const results = await Promise.allSettled(connectionPromises);

		// Check if any strict servers failed
		const failedStrictServers = strictServers.filter(
			name => this.failedConnections[name] !== undefined
		);

		if (failedStrictServers.length > 0) {
			const errorMessage = `${ERROR_MESSAGES.MISSING_REQUIRED_SERVERS}: ${failedStrictServers.join(', ')}`;
			this.logger.error(`${LOG_PREFIXES.MANAGER} ${errorMessage}`, {
				failedServers: failedStrictServers,
			});
			throw new Error(errorMessage);
		}

		const successCount = results.filter(result => result.status === 'fulfilled').length;
		const failureCount = results.filter(result => result.status === 'rejected').length;

		if (!this.quietMode) {
			this.logger.info(`${LOG_PREFIXES.MANAGER} Initialization complete`, {
				successCount,
				failureCount,
				totalCount: Object.keys(serverConfigs).length,
				strictServerCount: strictServers.length,
			});
		}
	}

	/**
	 * Connect to a new MCP server.
	 */
	async connectServer(name: string, config: McpServerConfig): Promise<void> {
		if (!this.quietMode) {
			this.logger.info(`${LOG_PREFIXES.MANAGER} Connecting to server: ${name}`, {
				serverName: name,
				transportType: config.type,
				connectionMode: config.connectionMode,
			});
		}

		try {
			// Create and register client if not already registered
			if (!this.clients.has(name)) {
				const client = new MCPClient();
				if (this.quietMode) {
					client.setQuietMode(true);
				}
				this.registerClient(name, client);
			}

			const entry = this.clients.get(name)!;
			entry.config = config;

			// Connect the client
			await entry.client.connect(config, name);

			// Update registry
			entry.connected = true;
			entry.lastSeen = Date.now();
			entry.failureCount = 0;

			// Clear any previous failure record
			delete this.failedConnections[name];

			// Emit MCP client connected event
			if (this.eventManager) {
				this.eventManager.emitServiceEvent(ServiceEvents.MCP_CLIENT_CONNECTED, {
					clientId: name,
					serverName: name,
					timestamp: Date.now(),
				});
			}

			if (!this.quietMode) {
				this.logger.info(`${LOG_PREFIXES.MANAGER} Successfully connected to server: ${name}`, {
					serverName: name,
				});
			}

			// Refresh caches to include new client's capabilities
			await this._refreshAllCaches();
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.failedConnections[name] = errorMessage;
			this._updateClientFailure(name);

			// Emit MCP client connection error event
			if (this.eventManager) {
				this.eventManager.emitServiceEvent(ServiceEvents.MCP_CLIENT_ERROR, {
					clientId: name,
					serverName: name,
					error: errorMessage,
					timestamp: Date.now(),
				});
			}

			this.logger.error(`${LOG_PREFIXES.MANAGER} Failed to connect to server: ${name}`, {
				serverName: name,
				error: errorMessage,
				connectionMode: config.connectionMode,
			});

			// Re-throw error for strict servers
			if (config.connectionMode === CONNECTION_MODES.STRICT) {
				throw error;
			}
		}
	}

	/**
	 * Get all registered clients.
	 */
	getClients(): Map<string, IMCPClient> {
		const clientMap = new Map<string, IMCPClient>();

		for (const [name, entry] of this.clients.entries()) {
			clientMap.set(name, entry.client);
		}

		return clientMap;
	}

	/**
	 * Get all servers with their connection status and configuration
	 */
	getAllServers(): Array<{
		id: string;
		name: string;
		status: 'connected' | 'error' | 'disconnected';
		config: any;
		lastSeen?: number;
		failureCount?: number;
		error?: string;
	}> {
		const servers: Array<{
			id: string;
			name: string;
			status: 'connected' | 'error' | 'disconnected';
			config: any;
			lastSeen?: number;
			failureCount?: number;
			error?: string;
		}> = [];

		// Add connected servers
		for (const [name, entry] of this.clients.entries()) {
			servers.push({
				id: name,
				name: name,
				status: entry.connected ? 'connected' : 'disconnected',
				config: {
					...entry.config,
					type: entry.config.type || 'stdio',
				},
				lastSeen: entry.lastSeen,
				failureCount: entry.failureCount,
			});
		}

		// Add failed servers that aren't in the clients registry
		for (const [name, error] of Object.entries(this.failedConnections)) {
			// Only add if not already in the clients list
			if (!this.clients.has(name)) {
				servers.push({
					id: name,
					name: name,
					status: 'error',
					config: {
						type: 'stdio', // Default, since we don't have the original config
					},
					error: error,
				});
			}
		}

		return servers;
	}

	/**
	 * Get errors from failed connections.
	 */
	getFailedConnections(): { [key: string]: string } {
		return { ...this.failedConnections };
	}

	/**
	 * Disconnect and remove a specific client.
	 */
	async removeClient(name: string): Promise<void> {
		const entry = this.clients.get(name);

		if (!entry) {
			this.logger.warn(`${LOG_PREFIXES.MANAGER} Client not found for removal: ${name}`, {
				clientName: name,
			});
			return;
		}

		this.logger.info(`${LOG_PREFIXES.MANAGER} Removing client: ${name}`, { clientName: name });

		try {
			if (entry.connected) {
				await entry.client.disconnect();
			}
		} catch (error) {
			this.logger.warn(
				`${LOG_PREFIXES.MANAGER} Error disconnecting client during removal: ${name}`,
				{ clientName: name, error: error instanceof Error ? error.message : String(error) }
			);
		}

		// Emit MCP client disconnected event
		if (this.eventManager) {
			this.eventManager.emitServiceEvent(ServiceEvents.MCP_CLIENT_DISCONNECTED, {
				clientId: name,
				serverName: name,
				reason: 'Client removed',
				timestamp: Date.now(),
			});
		}

		// Remove from registry
		this.clients.delete(name);

		// Clear from caches
		this._removeClientFromCaches(name);

		// Clear failure record
		delete this.failedConnections[name];

		this.logger.info(`${LOG_PREFIXES.MANAGER} Client removed successfully: ${name}`, {
			clientName: name,
			remainingClients: this.clients.size,
		});
	}

	/**
	 * Disconnect all clients and clear caches.
	 */
	async disconnectAll(): Promise<void> {
		this.logger.info(`${LOG_PREFIXES.MANAGER} Disconnecting all clients`, {
			clientCount: this.clients.size,
		});

		const disconnectPromises = Array.from(this.clients.entries()).map(async ([name, entry]) => {
			try {
				if (entry.connected) {
					await entry.client.disconnect();
				}
			} catch (error) {
				this.logger.warn(`${LOG_PREFIXES.MANAGER} Error disconnecting client: ${name}`, {
					clientName: name,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		});

		await Promise.allSettled(disconnectPromises);

		// Clear all state
		this.clients.clear();
		this.failedConnections = {};
		this._clearAllCaches();

		this.logger.info(`${LOG_PREFIXES.MANAGER} All clients disconnected and caches cleared`);
	}

	// ======================================================
	// Private Cache Management Methods
	// ======================================================

	/**
	 * Refresh tool cache from all connected clients.
	 */
	private async _refreshToolCache(): Promise<void> {
		this.toolCache.clear();
		this.toolClientMap.clear();

		await this.getAllTools(); // This will repopulate the cache
	}

	/**
	 * Refresh prompt cache from all connected clients.
	 */
	private async _refreshPromptCache(): Promise<void> {
		this.promptCache.clear();
		this.promptClientMap.clear();

		await this.listAllPrompts(); // This will repopulate the cache
	}

	/**
	 * Refresh resource cache from all connected clients.
	 */
	private async _refreshResourceCache(): Promise<void> {
		this.resourceCache.clear();
		this.resourceClientMap.clear();

		await this.listAllResources(); // This will repopulate the cache
	}

	/**
	 * Refresh all caches.
	 */
	private async _refreshAllCaches(): Promise<void> {
		await Promise.allSettled([
			this._refreshToolCache(),
			this._refreshPromptCache(),
			this._refreshResourceCache(),
		]);
	}

	/**
	 * Clean up expired cache entries.
	 */
	private _cleanupCache<T>(cache: Map<string, CacheEntry<T>>): void {
		if (cache.size <= this.maxCacheSize) {
			return;
		}

		const now = Date.now();
		const entriesToRemove: string[] = [];

		for (const [key, entry] of cache.entries()) {
			if (now - entry.timestamp > this.cacheTimeout) {
				entriesToRemove.push(key);
			}
		}

		// Remove expired entries
		entriesToRemove.forEach(key => cache.delete(key));

		// If still over limit, remove oldest entries
		if (cache.size > this.maxCacheSize) {
			const sortedEntries = Array.from(cache.entries()).sort(
				([, a], [, b]) => a.timestamp - b.timestamp
			);

			const toRemove = sortedEntries.slice(0, cache.size - this.maxCacheSize);
			toRemove.forEach(([key]) => cache.delete(key));
		}
	}

	/**
	 * Remove a client from all caches.
	 */
	private _removeClientFromCaches(clientName: string): void {
		// Remove from tool cache
		for (const [toolName, entry] of this.toolCache.entries()) {
			if (entry.clientName === clientName) {
				this.toolCache.delete(toolName);
				this.toolClientMap.delete(toolName);
			}
		}

		// Remove from prompt cache
		for (const [promptName, clientMapName] of this.promptClientMap.entries()) {
			if (clientMapName === clientName) {
				this.promptClientMap.delete(promptName);
			}
		}

		// Remove from resource cache
		for (const [resourceUri, clientMapName] of this.resourceClientMap.entries()) {
			if (clientMapName === clientName) {
				this.resourceClientMap.delete(resourceUri);
			}
		}
	}

	/**
	 * Clear all caches.
	 */
	private _clearAllCaches(): void {
		this.toolCache.clear();
		this.toolClientMap.clear();
		this.promptCache.clear();
		this.promptClientMap.clear();
		this.resourceCache.clear();
		this.resourceClientMap.clear();
	}

	/**
	 * Update client failure count and connected status.
	 */
	private _updateClientFailure(clientName: string): void {
		const entry = this.clients.get(clientName);
		if (entry) {
			entry.failureCount++;
			entry.connected = false;
			entry.lastSeen = Date.now();
		}
	}
}
