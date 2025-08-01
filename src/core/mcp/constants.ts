/**
 * Constants for the Model Context Protocol (MCP) module.
 *
 * This file contains all constant values used throughout the MCP implementation,
 * including default values, error messages, and configuration constants.
 */

// ======================================================
// Connection and Timeout Constants
// ======================================================

/**
 * Default timeout for MCP operations in milliseconds.
 * Used for all operations if not overridden in the server configuration.
 */
export const DEFAULT_TIMEOUT_MS = 60000; // 1 minute

/**
 * Default connection mode for servers.
 */
export const DEFAULT_CONNECTION_MODE = 'lenient';

/**
 * Minimum timeout value allowed for operations.
 */
export const MIN_TIMEOUT_MS = 5000; // 5 seconds

/**
 * Maximum timeout value allowed for operations.
 */
export const MAX_TIMEOUT_MS = 300000; // 5 minutes

// ======================================================
// Transport Types
// ======================================================

/**
 * Available transport types for MCP servers.
 */
export const TRANSPORT_TYPES = {
	STDIO: 'stdio',
	SSE: 'sse',
	STREAMABLE_HTTP: 'streamable-http',
} as const;

// ======================================================
// Connection Modes
// ======================================================

/**
 * Available connection modes.
 */
export const CONNECTION_MODES = {
	/**
	 * Strict mode requires the server to successfully connect.
	 * If connection fails, an error will be thrown.
	 */
	STRICT: 'strict',

	/**
	 * Lenient mode allows the server to fail connecting.
	 * If connection fails, a warning will be logged but no error will be thrown.
	 */
	LENIENT: 'lenient',
} as const;

// ======================================================
// Error Messages
// ======================================================

/**
 * Error messages used throughout the MCP module.
 */
export const ERROR_MESSAGES = {
	// Connection errors
	CONNECTION_FAILED: 'Failed to connect to MCP server',
	DISCONNECTION_FAILED: 'Failed to disconnect from MCP server',
	NOT_CONNECTED: 'Client not connected. Please call connect() first',

	// Tool execution errors
	TOOL_EXECUTION_FAILED: 'Tool execution failed',
	NO_CLIENT_FOR_TOOL: 'No client found for tool',

	// Prompt and resource errors
	NO_CLIENT_FOR_PROMPT: 'No client found for prompt',
	NO_CLIENT_FOR_RESOURCE: 'No client found for resource',
	PROMPT_NOT_FOUND: 'Prompt not found',
	RESOURCE_NOT_FOUND: 'Resource not found',

	// Server configuration errors
	INVALID_CONFIG: 'Invalid server configuration',
	UNSUPPORTED_SERVER_TYPE: 'Unsupported server type',

	// Client registry errors
	CLIENT_ALREADY_REGISTERED: 'Client already registered',
	MISSING_REQUIRED_SERVERS: 'Failed to connect to required strict servers',
};

// ======================================================
// Logging Constants
// ======================================================

/**
 * Log message prefixes for the MCP module.
 */
export const LOG_PREFIXES = {
	CONNECT: 'MCP Connection:',
	TOOL: 'MCP Tool:',
	PROMPT: 'MCP Prompt:',
	RESOURCE: 'MCP Resource:',
	MANAGER: 'MCP Manager:',
};

// ======================================================
// Environment Flags
// ======================================================

/**
 * Environment variables that affect the behavior of the MCP module.
 */
export const ENV_VARS = {
	/**
	 * Environment variable to set the global timeout for all MCP operations.
	 */
	GLOBAL_TIMEOUT: 'MCP_GLOBAL_TIMEOUT',

	/**
	 * Environment variable to set the default connection mode.
	 */
	DEFAULT_CONNECTION_MODE: 'MCP_DEFAULT_CONNECTION_MODE',
};
