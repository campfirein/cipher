/**
 * Core types and interfaces for the internal tools system.
 *
 * This module defines the type system for internal tools that work alongside
 * MCP tools to provide built-in agent capabilities like memory management,
 * session control, and system operations.
 */

import { Tool, ToolExecutionResult } from '../../mcp/types.js';
import type { EmbeddingManager } from '../embedding/index.js';
import type { VectorStoreManager } from '../../vector_storage/index.js';
import type { ILLMService } from '../llm/index.js';
import type { KnowledgeGraphManager } from '../../knowledge_graph/manager.js';

/**
 * Categories for organizing internal tools
 */
export type InternalToolCategory = 'memory' | 'session' | 'system' | 'knowledge_graph';

/**
 * Internal tool handler function signature
 */
export type InternalToolHandler<T = any, R = any> = (
	args: T,
	context?: InternalToolContext
) => Promise<R>;

/**
 * Internal tool definition extending the base Tool interface
 */
export interface InternalTool extends Tool {
	/**
	 * Unique name for the tool (should be prefixed with 'cipher_')
	 */
	name: string;

	/**
	 * Category for organizing tools
	 */
	category: InternalToolCategory;

	/**
	 * Marker to identify this as an internal tool
	 */
	internal: true;

	/**
	 * Whether this tool should be accessible to agents
	 * - true: Tool can be called by agents (e.g., search tools)
	 * - false: Tool is internal-only, used for background processing (e.g., extraction, storage)
	 * @default true
	 */
	agentAccessible?: boolean;

	/**
	 * Handler function that executes the tool
	 */
	handler: InternalToolHandler;

	/**
	 * Optional version for tool evolution
	 */
	version?: string;

	/**
	 * Human-readable description
	 */
	description: string;

	/**
	 * JSON schema for parameters
	 */
	parameters: {
		type: 'object';
		properties: Record<string, any>;
		required?: string[];
	};
}

/**
 * Collection of internal tools indexed by their names
 */
export interface InternalToolSet {
	[toolName: string]: InternalTool;
}

/**
 * Configuration for the internal tool manager
 */
export interface InternalToolManagerConfig {
	/**
	 * Whether to enable internal tools
	 * @default true
	 */
	enabled?: boolean;

	/**
	 * Maximum execution timeout for internal tools in milliseconds
	 * @default 30000 (30 seconds)
	 */
	timeout?: number;

	/**
	 * Whether to cache tool lookups for performance
	 * @default true
	 */
	enableCache?: boolean;

	/**
	 * Cache timeout in milliseconds
	 * @default 300000 (5 minutes)
	 */
	cacheTimeout?: number;
}

/**
 * Tool registration result
 */
export interface ToolRegistrationResult {
	/**
	 * Total tools attempted to register
	 */
	total: number;

	/**
	 * Successfully registered tools
	 */
	registered: string[];

	/**
	 * Failed tool registrations
	 */
	failed: Array<{
		name: string;
		error: string;
	}>;
}

/**
 * Tool execution context provided to handlers
 */
export interface InternalToolContext {
	/**
	 * Tool name being executed
	 */
	toolName: string;

	/**
	 * Execution start time
	 */
	startTime: number;

	/**
	 * Optional session ID if available
	 */
	sessionId: string | undefined;

	/**
	 * Any additional metadata
	 */
	metadata: Record<string, any> | undefined;

	/**
	 * Optional agent services for advanced tool operations
	 */
	services?: {
		/**
		 * Embedding manager for text embeddings
		 */
		embeddingManager?: EmbeddingManager;

		/**
		 * Vector storage manager for similarity search
		 */
		vectorStoreManager?: VectorStoreManager;

		/**
		 * LLM service for intelligent reasoning (Phase 3)
		 */
		llmService?: ILLMService;

		/**
		 * Knowledge graph manager for graph operations
		 */
		knowledgeGraphManager?: KnowledgeGraphManager;

		/**
		 * Agentic memory system for memory operations
		 */
		agenticMemory?: any;
	};

	/**
	 * User ID for personalized behavior
	 */
	userId?: string;
}

/**
 * Statistics for internal tool usage
 */
export interface ToolExecutionStats {
	/**
	 * Tool name
	 */
	toolName: string;

	/**
	 * Total executions
	 */
	totalExecutions: number;

	/**
	 * Successful executions
	 */
	successfulExecutions: number;

	/**
	 * Failed executions
	 */
	failedExecutions: number;

	/**
	 * Average execution time in milliseconds
	 */
	averageExecutionTime: number;

	/**
	 * Last execution timestamp
	 */
	lastExecution?: string;

	/**
	 * Last error message
	 */
	lastError?: string;
}

/**
 * Interface for internal tool manager
 */
export interface IInternalToolManager {
	/**
	 * Initialize the internal tool manager
	 */
	initialize(): Promise<void>;

	/**
	 * Register a new internal tool
	 */
	registerTool(tool: InternalTool): { success: boolean; message: string; conflictedWith?: string };

	/**
	 * Unregister an internal tool
	 */
	unregisterTool(toolName: string): boolean;

	/**
	 * Get all registered internal tools
	 */
	getAllTools(): InternalToolSet;

	/**
	 * Get a specific internal tool by name
	 */
	getTool(toolName: string): InternalTool | undefined;

	/**
	 * Check if a tool name is an internal tool
	 */
	isInternalTool(toolName: string): boolean;

	/**
	 * Execute an internal tool
	 */
	executeTool(
		toolName: string,
		args: any,
		context?: Partial<InternalToolContext>
	): Promise<ToolExecutionResult>;

	/**
	 * Get tools by category
	 */
	getToolsByCategory(category: InternalToolCategory): InternalToolSet;

	/**
	 * Get execution statistics for a tool
	 */
	getToolStats(toolName: string): ToolExecutionStats | undefined;

	/**
	 * Get overall manager statistics
	 */
	getManagerStats(): {
		totalTools: number;
		toolsByCategory: Record<InternalToolCategory, number>;
		totalExecutions: number;
	};

	/**
	 * Clear all execution statistics
	 */
	clearStats(): void;

	/**
	 * Shutdown the internal tool manager
	 */
	shutdown(): Promise<void>;
}

/**
 * Prefix for all internal tool names to avoid conflicts
 */
export const INTERNAL_TOOL_PREFIX = 'cipher_';

/**
 * Helper function to create internal tool name
 */
export function createInternalToolName(baseName: string): string {
	return baseName.startsWith(INTERNAL_TOOL_PREFIX)
		? baseName
		: `${INTERNAL_TOOL_PREFIX}${baseName}`;
}

/**
 * Helper function to check if a tool name is internal
 */
export function isInternalToolName(toolName: string): boolean {
	return toolName.startsWith(INTERNAL_TOOL_PREFIX);
}
