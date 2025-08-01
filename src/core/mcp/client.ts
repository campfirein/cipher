/**
 * MCPClient implementation for the Model Context Protocol (MCP) module.
 *
 * This file contains the MCPClient class that handles connection management,
 * transport abstraction, and operations for a single MCP server.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { GetPromptResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

import type {
	IMCPClient,
	McpServerConfig,
	StdioServerConfig,
	SseServerConfig,
	StreamableHttpServerConfig,
	ToolSet,
	ToolExecutionResult,
} from './types.js';

import {
	DEFAULT_TIMEOUT_MS,
	ERROR_MESSAGES,
	LOG_PREFIXES,
	TRANSPORT_TYPES,
	ENV_VARS,
} from './constants.js';

import { Logger, createLogger } from '../logger/index.js';

/**
 * Implementation of the IMCPClient interface for managing connections to MCP servers.
 * Supports stdio, SSE, and HTTP transports with comprehensive error handling and timeout management.
 */
export class MCPClient implements IMCPClient {
	private client: Client | null = null;
	private transport: Transport | null = null;
	private connected: boolean = false;
	private serverConfig: McpServerConfig | null = null;
	private serverName: string = '';
	private logger: Logger;
	private connectionPromise: Promise<Client> | null = null;
	private quietMode = false;

	// Server process information (for stdio connections)
	private serverInfo = {
		spawned: false,
		pid: null as number | null,
		command: null as string | null,
		originalArgs: null as string[] | null,
		resolvedArgs: null as string[] | null,
		env: null as Record<string, string> | null,
		alias: null as string | null,
	};

	constructor() {
		this.logger = createLogger({ level: 'info' });
	}

	/**
	 * Enable quiet mode to reduce logging verbosity (useful for CLI mode)
	 */
	setQuietMode(quiet: boolean): void {
		this.quietMode = quiet;
	}

	/**
	 * Connect to an MCP server using the provided configuration.
	 */
	async connect(config: McpServerConfig, serverName: string): Promise<Client> {
		if (this.connected && this.client) {
			this.logger.warn(`${LOG_PREFIXES.CONNECT} Already connected to ${serverName}`);
			return this.client;
		}

		// If connection is already in progress, return the existing promise
		if (this.connectionPromise) {
			return this.connectionPromise;
		}

		this.connectionPromise = this._performConnection(config, serverName);

		try {
			const client = await this.connectionPromise;
			this.connectionPromise = null;
			return client;
		} catch (error) {
			this.connectionPromise = null;
			throw error;
		}
	}

	/**
	 * Internal method to perform the actual connection.
	 */
	private async _performConnection(config: McpServerConfig, serverName: string): Promise<Client> {
		this.serverConfig = config;
		this.serverName = serverName;

		if (!this.quietMode) {
			this.logger.info(`${LOG_PREFIXES.CONNECT} Connecting to ${serverName} (${config.type})`, {
				serverName,
				transportType: config.type,
			});
		}

		try {
			// Create transport based on configuration type
			this.transport = await this._createTransport(config);

			// Create and connect the client
			this.client = new Client(
				{
					name: `cipher-mcp-client-${serverName}`,
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

			const timeout = this._getOperationTimeout(config);

			// Connect with timeout
			await this._connectWithTimeout(this.transport, timeout);

			this.connected = true;

			if (!this.quietMode) {
				this.logger.info(`${LOG_PREFIXES.CONNECT} Successfully connected to ${serverName}`, {
					serverName,
					timeout,
				});
			}

			return this.client;
		} catch (error) {
			await this._cleanup();

			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logger.error(
				`${LOG_PREFIXES.CONNECT} ${ERROR_MESSAGES.CONNECTION_FAILED}: ${serverName}`,
				{ serverName, error: errorMessage, transportType: config.type }
			);

			throw new Error(`${ERROR_MESSAGES.CONNECTION_FAILED}: ${errorMessage}`);
		}
	}

	/**
	 * Create transport based on server configuration.
	 */
	private async _createTransport(config: McpServerConfig): Promise<Transport> {
		switch (config.type) {
			case TRANSPORT_TYPES.STDIO:
				return this._createStdioTransport(config as StdioServerConfig);

			case TRANSPORT_TYPES.SSE:
				return this._createSseTransport(config as SseServerConfig);

			case TRANSPORT_TYPES.STREAMABLE_HTTP:
				return this._createStreamableHttpTransport(config as StreamableHttpServerConfig);

			default:
				throw new Error(`${ERROR_MESSAGES.UNSUPPORTED_SERVER_TYPE}: ${(config as any).type}`);
		}
	}

	/**
	 * Create stdio transport.
	 */
	private async _createStdioTransport(config: StdioServerConfig): Promise<Transport> {
		const resolvedCommand = this._resolveCommand(config.command);
		const resolvedArgs = this._resolveArgs(config.args || []);
		const env = this._mergeEnvironment(config.env || {});

		// Store server info for stdio connections
		this.serverInfo = {
			spawned: true,
			pid: null, // Will be set after spawn
			command: resolvedCommand,
			originalArgs: config.args || [],
			resolvedArgs,
			env,
			alias: this.serverName,
		};

		this.logger.debug(`${LOG_PREFIXES.CONNECT} Creating stdio transport`, {
			command: resolvedCommand,
			args: resolvedArgs,
			serverName: this.serverName,
		});

		const transport = new StdioClientTransport({
			command: resolvedCommand,
			args: resolvedArgs,
			env,
		});

		return transport;
	}

	/**
	 * Create SSE transport.
	 */
	private async _createSseTransport(config: SseServerConfig): Promise<Transport> {
		this.logger.debug(`${LOG_PREFIXES.CONNECT} Creating SSE transport`, {
			url: config.url,
			serverName: this.serverName,
		});

		// Create SSE transport with optional headers support via requestInit
		const transportOptions = config.headers
			? { requestInit: { headers: config.headers } }
			: undefined;
		const transport = new SSEClientTransport(new URL(config.url), transportOptions);
		return transport;
	}

	/**
	 * Create streamable HTTP transport.
	 */
	private async _createStreamableHttpTransport(
		config: StreamableHttpServerConfig
	): Promise<Transport> {
		this.logger.debug(`${LOG_PREFIXES.CONNECT} Creating streamable HTTP transport`, {
			url: config.url,
			serverName: this.serverName,
		});

		// Create streamable HTTP transport with optional headers support via requestInit
		const transportOptions = config.headers
			? { requestInit: { headers: config.headers } }
			: undefined;
		const transport = new StreamableHTTPClientTransport(new URL(config.url), transportOptions);
		// Ensure sessionId is always a string to satisfy Transport interface
		if (transport.sessionId === undefined) {
			Object.defineProperty(transport, 'sessionId', {
				value: '',
				writable: true,
				enumerable: true,
				configurable: true,
			});
		}
		return transport as Transport;
	}

	/**
	 * Connect client to transport with timeout.
	 */
	private async _connectWithTimeout(transport: Transport, timeout: number): Promise<void> {
		if (!this.client) {
			throw new Error('Client not initialized');
		}

		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				reject(new Error(`Connection timeout after ${timeout}ms`));
			}, timeout);

			this.client!.connect(transport)
				.then(() => {
					clearTimeout(timeoutId);
					resolve();
				})
				.catch(error => {
					clearTimeout(timeoutId);
					reject(error);
				});
		});
	}

	/**
	 * Disconnect from the MCP server.
	 */
	async disconnect(): Promise<void> {
		if (!this.connected) {
			this.logger.warn(`${LOG_PREFIXES.CONNECT} Already disconnected from ${this.serverName}`);
			return;
		}

		this.logger.info(`${LOG_PREFIXES.CONNECT} Disconnecting from ${this.serverName}`);

		try {
			await this._cleanup();
			this.logger.info(`${LOG_PREFIXES.CONNECT} Successfully disconnected from ${this.serverName}`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logger.error(
				`${LOG_PREFIXES.CONNECT} ${ERROR_MESSAGES.DISCONNECTION_FAILED}: ${this.serverName}`,
				{ serverName: this.serverName, error: errorMessage }
			);
			throw new Error(`${ERROR_MESSAGES.DISCONNECTION_FAILED}: ${errorMessage}`);
		}
	}

	/**
	 * Call a tool with the given name and arguments.
	 */
	async callTool(name: string, args: any): Promise<ToolExecutionResult> {
		this._ensureConnected();

		const timeout = this._getOperationTimeout();

		this.logger.info(`${LOG_PREFIXES.TOOL} Calling tool: ${name}`, {
			toolName: name,
			serverName: this.serverName,
			timeout,
		});

		try {
			const result = await this._executeWithTimeout(
				() => this.client!.callTool({ name, arguments: args }),
				timeout,
				`Tool execution timeout: ${name}`
			);

			this.logger.info(`${LOG_PREFIXES.TOOL} Tool executed successfully: ${name}`, {
				toolName: name,
				serverName: this.serverName,
			});

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logger.error(`${LOG_PREFIXES.TOOL} ${ERROR_MESSAGES.TOOL_EXECUTION_FAILED}: ${name}`, {
				toolName: name,
				serverName: this.serverName,
				error: errorMessage,
			});
			throw new Error(`${ERROR_MESSAGES.TOOL_EXECUTION_FAILED}: ${errorMessage}`);
		}
	}

	/**
	 * Get all tools provided by this client.
	 */
	async getTools(): Promise<ToolSet> {
		this._ensureConnected();

		const timeout = this._getOperationTimeout();

		try {
			const result = await this._executeWithTimeout(
				() => this.client!.listTools(),
				timeout,
				'List tools timeout'
			);

			const toolSet: ToolSet = {};
			result.tools.forEach(tool => {
				toolSet[tool.name] = {
					description: tool.description || '',
					parameters: tool.inputSchema as any,
				};
			});

			this.logger.debug(`${LOG_PREFIXES.TOOL} Retrieved ${Object.keys(toolSet).length} tools`, {
				serverName: this.serverName,
				toolCount: Object.keys(toolSet).length,
			});

			return toolSet;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logger.error(`${LOG_PREFIXES.TOOL} Failed to list tools`, {
				serverName: this.serverName,
				error: errorMessage,
			});
			throw error;
		}
	}

	/**
	 * List all prompts provided by this client.
	 */
	async listPrompts(): Promise<string[]> {
		this._ensureConnected();

		const timeout = this._getOperationTimeout();

		try {
			const result = await this._executeWithTimeout(
				() => this.client!.listPrompts(),
				timeout,
				'List prompts timeout'
			);

			const promptNames = result.prompts.map(prompt => prompt.name);

			this.logger.debug(`${LOG_PREFIXES.PROMPT} Retrieved ${promptNames.length} prompts`, {
				serverName: this.serverName,
				promptCount: promptNames.length,
			});

			return promptNames;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);

			// Check if this is a "capability not supported" error (common for filesystem servers)
			const isCapabilityError =
				errorMessage.includes('not implemented') ||
				errorMessage.includes('not supported') ||
				errorMessage.includes('Method not found') ||
				errorMessage.includes('prompts') === false; // Some servers just don't respond to prompt requests

			if (isCapabilityError) {
				this.logger.debug(
					`${LOG_PREFIXES.PROMPT} Prompts not supported by server (this is normal)`,
					{
						serverName: this.serverName,
						reason: 'Server does not implement prompt capability',
					}
				);
				return []; // Return empty array instead of throwing
			}

			// Real error - log as error and throw
			this.logger.error(`${LOG_PREFIXES.PROMPT} Failed to list prompts`, {
				serverName: this.serverName,
				error: errorMessage,
			});
			throw error;
		}
	}

	/**
	 * Get a prompt by name.
	 */
	async getPrompt(name: string, args?: any): Promise<GetPromptResult> {
		this._ensureConnected();

		const timeout = this._getOperationTimeout();

		this.logger.info(`${LOG_PREFIXES.PROMPT} Getting prompt: ${name}`, {
			promptName: name,
			serverName: this.serverName,
		});

		try {
			const result = await this._executeWithTimeout(
				() => this.client!.getPrompt({ name, arguments: args }),
				timeout,
				`Get prompt timeout: ${name}`
			);

			this.logger.info(`${LOG_PREFIXES.PROMPT} Retrieved prompt successfully: ${name}`, {
				promptName: name,
				serverName: this.serverName,
			});

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logger.error(`${LOG_PREFIXES.PROMPT} Failed to get prompt: ${name}`, {
				promptName: name,
				serverName: this.serverName,
				error: errorMessage,
			});
			throw error;
		}
	}

	/**
	 * List all resources provided by this client.
	 */
	async listResources(): Promise<string[]> {
		this._ensureConnected();

		const timeout = this._getOperationTimeout();

		try {
			const result = await this._executeWithTimeout(
				() => this.client!.listResources(),
				timeout,
				'List resources timeout'
			);

			const resourceUris = result.resources.map(resource => resource.uri);

			this.logger.debug(`${LOG_PREFIXES.RESOURCE} Retrieved ${resourceUris.length} resources`, {
				serverName: this.serverName,
				resourceCount: resourceUris.length,
			});

			return resourceUris;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);

			// Check if this is a "capability not supported" error (common for filesystem servers)
			const isCapabilityError =
				errorMessage.includes('not implemented') ||
				errorMessage.includes('not supported') ||
				errorMessage.includes('Method not found') ||
				errorMessage.includes('resources') === false; // Some servers just don't respond to resource requests

			if (isCapabilityError) {
				this.logger.debug(
					`${LOG_PREFIXES.RESOURCE} Resources not supported by server (this is normal)`,
					{
						serverName: this.serverName,
						reason: 'Server does not implement resource capability',
					}
				);
				return []; // Return empty array instead of throwing
			}

			// Real error - log as error and throw
			this.logger.error(`${LOG_PREFIXES.RESOURCE} Failed to list resources`, {
				serverName: this.serverName,
				error: errorMessage,
			});
			throw error;
		}
	}

	/**
	 * Read a resource by URI.
	 */
	async readResource(uri: string): Promise<ReadResourceResult> {
		this._ensureConnected();

		const timeout = this._getOperationTimeout();

		this.logger.info(`${LOG_PREFIXES.RESOURCE} Reading resource: ${uri}`, {
			resourceUri: uri,
			serverName: this.serverName,
		});

		try {
			const result = await this._executeWithTimeout(
				() => this.client!.readResource({ uri }),
				timeout,
				`Read resource timeout: ${uri}`
			);

			this.logger.info(`${LOG_PREFIXES.RESOURCE} Read resource successfully: ${uri}`, {
				resourceUri: uri,
				serverName: this.serverName,
			});

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logger.error(`${LOG_PREFIXES.RESOURCE} Failed to read resource: ${uri}`, {
				resourceUri: uri,
				serverName: this.serverName,
				error: errorMessage,
			});
			throw error;
		}
	}

	/**
	 * Get the connection status of the client.
	 */
	getConnectionStatus(): boolean {
		return this.connected;
	}

	/**
	 * Get the underlying MCP client instance.
	 */
	getClient(): Client | null {
		return this.client;
	}

	/**
	 * Get information about the connected server.
	 */
	getServerInfo() {
		return { ...this.serverInfo };
	}

	/**
	 * Get the client instance once connected.
	 */
	async getConnectedClient(): Promise<Client> {
		if (this.connected && this.client) {
			return this.client;
		}

		if (this.connectionPromise) {
			return this.connectionPromise;
		}

		throw new Error(ERROR_MESSAGES.NOT_CONNECTED);
	}

	// ======================================================
	// Private Utility Methods
	// ======================================================

	/**
	 * Ensure the client is connected before performing operations.
	 */
	private _ensureConnected(): void {
		if (!this.connected || !this.client) {
			throw new Error(ERROR_MESSAGES.NOT_CONNECTED);
		}
	}

	/**
	 * Get the operation timeout from configuration or default.
	 */
	private _getOperationTimeout(config?: McpServerConfig): number {
		if (config?.timeout) {
			return config.timeout;
		}

		if (this.serverConfig?.timeout) {
			return this.serverConfig.timeout;
		}

		// Check environment variable
		const envTimeout = process.env[ENV_VARS.GLOBAL_TIMEOUT];
		if (envTimeout) {
			const parsed = parseInt(envTimeout, 10);
			if (!isNaN(parsed) && parsed > 0) {
				return parsed;
			}
		}

		return DEFAULT_TIMEOUT_MS;
	}

	/**
	 * Execute a function with timeout.
	 */
	private async _executeWithTimeout<T>(
		operation: () => Promise<T>,
		timeout: number,
		timeoutMessage: string
	): Promise<T> {
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				reject(new Error(timeoutMessage));
			}, timeout);

			operation()
				.then(result => {
					clearTimeout(timeoutId);
					resolve(result);
				})
				.catch(error => {
					clearTimeout(timeoutId);
					reject(error);
				});
		});
	}

	/**
	 * Resolve command path, handling bundled scripts and relative paths.
	 */
	private _resolveCommand(command: string): string {
		// If it's already an absolute path, return as-is
		if (path.isAbsolute(command)) {
			return command;
		}

		// Check if it's a relative path from current working directory
		const cwdPath = path.resolve(process.cwd(), command);
		if (fs.existsSync(cwdPath)) {
			return cwdPath;
		}

		// Check if it's a bundled script relative to module
		try {
			const moduleDir = path.dirname(fileURLToPath(import.meta.url));
			const bundledPath = path.resolve(moduleDir, '../../../', command);
			if (fs.existsSync(bundledPath)) {
				return bundledPath;
			}
		} catch {
			// Ignore errors from import.meta.url resolution
		}

		// Return original command (might be in PATH)
		return command;
	}

	/**
	 * Resolve arguments, performing any necessary path resolution.
	 */
	private _resolveArgs(args: string[]): string[] {
		return args.map(arg => {
			// If argument looks like a path (contains / or \), try to resolve it
			if (arg.includes('/') || arg.includes('\\')) {
				const resolved = this._resolveCommand(arg);
				return resolved;
			}
			return arg;
		});
	}

	/**
	 * Merge environment variables with current process environment.
	 */
	private _mergeEnvironment(configEnv: Record<string, string>): Record<string, string> {
		// Filter out undefined values from env and convert to proper process.env format
		const processEnv = Object.fromEntries(
			Object.entries(process.env).filter(([_, value]) => value !== undefined)
		) as Record<string, string>;

		return {
			...processEnv,
			...configEnv,
		};
	}

	/**
	 * Clean up resources and reset state.
	 */
	private async _cleanup(): Promise<void> {
		this.connected = false;

		if (this.client) {
			try {
				await this.client.close();
			} catch (_error) {
				// Log but don't throw cleanup errors
				this.logger.warn(`${LOG_PREFIXES.CONNECT} Error during client cleanup`, {
					error: _error instanceof Error ? _error.message : String(_error),
				});
			}
			this.client = null;
		}

		if (this.transport) {
			try {
				await this.transport.close();
			} catch (_error) {
				// Log but don't throw cleanup errors
				this.logger.warn(`${LOG_PREFIXES.CONNECT} Error during transport cleanup`, {
					error: _error instanceof Error ? _error.message : String(_error),
				});
			}
			this.transport = null;
		}

		// Reset server info
		this.serverInfo = {
			spawned: false,
			pid: null,
			command: null,
			originalArgs: null,
			resolvedArgs: null,
			env: null,
			alias: null,
		};

		this.serverConfig = null;
		this.serverName = '';
	}
}
