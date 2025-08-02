/**
 * Core types and interfaces for the Model Context Protocol (MCP) module.
 *
 * This file contains all the type definitions needed for working with MCP servers,
 * including client interfaces, server configurations, and tool/prompt/resource types.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { GetPromptResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

// ======================================================
// Transport and Connection Types
// ======================================================

/**
 * Available MCP client transport types for connecting to MCP servers.
 * These define the communication protocol used to connect to individual MCP servers.
 */
export type TransportType = 'stdio' | 'sse' | 'streamable-http';

/**
 * Available server configuration types.
 * Includes both transport types (for direct server connections) and operational modes (like aggregator).
 */
export type ServerConfigType = TransportType | 'aggregator';

/**
 * Base configuration for any MCP server.
 */
export interface BaseServerConfig {
	/**
	 * Configuration type: transport protocol for direct connections or operational mode.
	 * - Transport types ('stdio', 'sse', 'streamable-http'): Connect directly to MCP servers
	 * - Operational modes ('aggregator'): Special server modes that aggregate other servers
	 */
	type: ServerConfigType;

	/**
	 * Whether this server is enabled. Disabled servers will be skipped during initialization.
	 * @default true
	 */
	enabled?: boolean;

	/**
	 * Connection mode determines how failures to connect are handled.
	 * - 'strict': Connection failures will throw errors and halt initialization.
	 * - 'lenient': Connection failures will be logged but won't stop other servers from connecting.
	 * @default 'lenient'
	 */
	connectionMode?: 'strict' | 'lenient';

	/**
	 * Timeout in milliseconds for server operations.
	 * @default 60000 (1 minute)
	 */
	timeout?: number;
}

/**
 * Configuration for a stdio-based MCP server.
 */
export interface StdioServerConfig extends BaseServerConfig {
	type: 'stdio';

	/**
	 * Command to run the server.
	 */
	command: string;

	/**
	 * Arguments to pass to the command.
	 */
	args: string[];

	/**
	 * Environment variables to set for the command.
	 */
	env?: Record<string, string>;
}

/**
 * Configuration for an SSE-based MCP server.
 */
export interface SseServerConfig extends BaseServerConfig {
	type: 'sse';

	/**
	 * URL of the SSE server.
	 */
	url: string;

	/**
	 * Headers to include with requests.
	 */
	headers?: Record<string, string>;
}

/**
 * Configuration for a streamable HTTP-based MCP server.
 */
export interface StreamableHttpServerConfig extends BaseServerConfig {
	type: 'streamable-http';

	/**
	 * URL of the streamable HTTP server.
	 */
	url: string;

	/**
	 * Headers to include with requests.
	 */
	headers?: Record<string, string>;
}

/**
 * Union type representing any valid MCP server configuration.
 */
export type McpServerConfig = StdioServerConfig | SseServerConfig | StreamableHttpServerConfig;

/**
 * Configuration for aggregator mode.
 */
export interface AggregatorConfig extends BaseServerConfig {
	type: 'aggregator';

	/**
	 * Servers to aggregate from.
	 */
	servers: ServerConfigs;

	/**
	 * Strategy for handling tool name conflicts.
	 * - 'prefix': Prefix conflicting tools with server name
	 * - 'first-wins': First registered tool takes precedence
	 * - 'error': Throw error on conflicts
	 * @default 'prefix'
	 */
	conflictResolution?: 'prefix' | 'first-wins' | 'error';

	/**
	 * Whether to auto-discover new servers in the network.
	 * @default false
	 */
	autoDiscovery?: boolean;
}

/**
 * Union type representing any valid MCP server configuration including aggregator.
 */
export type ExtendedMcpServerConfig = McpServerConfig | AggregatorConfig;

/**
 * Record mapping server names to their configurations.
 */
export type ServerConfigs = Record<string, McpServerConfig>;

// ======================================================
// Tool and Resource Types
// ======================================================

/**
 * Represents a tool parameter schema.
 */
export interface ToolParameterSchema {
	type: string;
	description?: string;
	[key: string]: any;
}

/**
 * Represents a tool parameter definition.
 */
export interface ToolParameterDefinition {
	[parameterName: string]: ToolParameterSchema;
}

/**
 * Represents a tool's parameter definitions and requirements.
 */
export interface ToolParameters {
	type: string;
	properties: ToolParameterDefinition;
	required?: string[];
}

/**
 * Represents a single tool definition.
 */
export interface Tool {
	description: string;
	parameters: ToolParameters;
}

/**
 * A collection of tools indexed by their names.
 */
export interface ToolSet {
	[toolName: string]: Tool;
}

/**
 * Result of a tool execution.
 */
export type ToolExecutionResult = any;

// ======================================================
// Client Interface
// ======================================================

/**
 * Interface for an MCP client that communicates with a single MCP server.
 */
export interface IMCPClient {
	/**
	 * Connect to an MCP server using the provided configuration.
	 */
	connect(config: McpServerConfig, serverName: string): Promise<Client>;

	/**
	 * Disconnect from the MCP server.
	 */
	disconnect(): Promise<void>;

	/**
	 * Call a tool with the given name and arguments.
	 */
	callTool(name: string, args: any): Promise<ToolExecutionResult>;

	/**
	 * Get all tools provided by this client.
	 */
	getTools(): Promise<ToolSet>;

	/**
	 * List all prompts provided by this client.
	 */
	listPrompts(): Promise<string[]>;

	/**
	 * Get a prompt by name.
	 */
	getPrompt(name: string, args?: any): Promise<GetPromptResult>;

	/**
	 * List all resources provided by this client.
	 */
	listResources(): Promise<string[]>;

	/**
	 * Read a resource by URI.
	 */
	readResource(uri: string): Promise<ReadResourceResult>;

	/**
	 * Get the connection status of the client.
	 */
	getConnectionStatus(): boolean;

	/**
	 * Get the underlying MCP client instance.
	 */
	getClient(): Client | null;

	/**
	 * Get information about the connected server.
	 */
	getServerInfo(): {
		spawned: boolean;
		pid: number | null;
		command: string | null;
		originalArgs: string[] | null;
		resolvedArgs: string[] | null;
		env: Record<string, string> | null;
		alias: string | null;
	};

	/**
	 * Get the client instance once connected.
	 */
	getConnectedClient(): Promise<Client>;
}

// ======================================================
// Manager Interface
// ======================================================

/**
 * Interface for the MCP Manager that orchestrates multiple MCP clients.
 */
export interface IMCPManager {
	/**
	 * Register a client with the manager.
	 */
	registerClient(name: string, client: IMCPClient): void;

	/**
	 * Get all available tools from all connected clients.
	 */
	getAllTools(): Promise<ToolSet>;

	/**
	 * Get the client that provides a specific tool.
	 */
	getToolClient(toolName: string): IMCPClient | undefined;

	/**
	 * Execute a tool with the given name and arguments.
	 */
	executeTool(toolName: string, args: any): Promise<ToolExecutionResult>;

	/**
	 * List all available prompts from all connected clients.
	 */
	listAllPrompts(): Promise<string[]>;

	/**
	 * Get the client that provides a specific prompt.
	 */
	getPromptClient(promptName: string): IMCPClient | undefined;

	/**
	 * Get a prompt by name.
	 */
	getPrompt(name: string, args?: any): Promise<GetPromptResult>;

	/**
	 * List all available resources from all connected clients.
	 */
	listAllResources(): Promise<string[]>;

	/**
	 * Get the client that provides a specific resource.
	 */
	getResourceClient(resourceUri: string): IMCPClient | undefined;

	/**
	 * Read a resource by URI.
	 */
	readResource(uri: string): Promise<ReadResourceResult>;

	/**
	 * Initialize clients from server configurations.
	 */
	initializeFromConfig(serverConfigs: ServerConfigs): Promise<void>;

	/**
	 * Connect to a new MCP server.
	 */
	connectServer(name: string, config: McpServerConfig): Promise<void>;

	/**
	 * Get all registered clients.
	 */
	getClients(): Map<string, IMCPClient>;

	/**
	 * Get errors from failed connections.
	 */
	getFailedConnections(): { [key: string]: string };

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
	}>;

	/**
	 * Disconnect and remove a specific client.
	 */
	removeClient(name: string): Promise<void>;

	/**
	 * Disconnect all clients and clear caches.
	 */
	disconnectAll(): Promise<void>;
}

/**
 * Tool registry entry for tracking tool metadata.
 */
export interface ToolRegistryEntry {
	tool: Tool;
	clientName: string;
	originalName: string;
	registeredName: string;
	timestamp: number;
}

/**
 * Interface for aggregator-specific functionality.
 */
export interface IAggregatorManager extends IMCPManager {
	/**
	 * Start the aggregator server.
	 */
	startServer(config: AggregatorConfig): Promise<void>;

	/**
	 * Stop the aggregator server.
	 */
	stopServer(): Promise<void>;

	/**
	 * Get the aggregated tool registry.
	 */
	getToolRegistry(): Map<string, ToolRegistryEntry>;

	/**
	 * Discover available MCP servers in the network.
	 */
	discoverServers(): Promise<ServerConfigs>;

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
	};
}
