/**
 * Tool Definitions Module
 *
 * This module exports all internal tool definitions for the Cipher agent.
 * It provides a centralized registry of all available tools organized by category.
 */

// Export all tool categories
export * from './memory/index.js';
export * from './knowledge_graph/index.js';

// Import types and utilities
import type { InternalToolSet } from '../types.js';
import { logger } from '../../../logger/index.js';
import { env } from '../../../env.js';

/**
 * Get all tools from all categories
 */
export async function getAllToolDefinitions(
	options: { embeddingEnabled?: boolean } = {}
): Promise<InternalToolSet> {
	try {
		// Tool loading logging reduced for cleaner CLI experience

		// Load memory tools with embedding status
		const memoryTools = await import('./memory/index.js').then(m => m.getMemoryTools(options));

		// Conditionally load knowledge graph tools based on environment setting
		let knowledgeGraphTools: InternalToolSet = {};
		if (env.KNOWLEDGE_GRAPH_ENABLED) {
			logger.debug('Knowledge graph enabled, loading knowledge graph tools');
			knowledgeGraphTools = await import('./knowledge_graph/index.js').then(m =>
				m.getKnowledgeGraphTools()
			);
		} else {
			logger.debug('Knowledge graph disabled, skipping knowledge graph tools');
		}

		// Combine all tools (reasoning tools are already included in memoryTools now)
		const allTools: InternalToolSet = {
			...memoryTools,
			...knowledgeGraphTools,
		};

		// Tool loading completion logging reduced for cleaner CLI experience

		return allTools;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error('Failed to load tool definitions', { error: errorMessage });
		throw new Error(`Failed to load tool definitions: ${errorMessage}`);
	}
}

/**
 * Register all tool definitions with the internal tool manager
 */
export async function registerAllTools(
	toolManager: any,
	options: { embeddingEnabled?: boolean } = {}
): Promise<{
	registered: string[];
	failed: { name: string; error: string }[];
	total: number;
}> {
	try {
		// Tool registration logging reduced for cleaner CLI experience

		const tools = await getAllToolDefinitions(options);
		const registered: string[] = [];
		const failed: { name: string; error: string }[] = [];

		// Register each tool
		for (const [toolName, tool] of Object.entries(tools)) {
			try {
				const result = toolManager.registerTool(tool);
				if (result.success) {
					registered.push(toolName);
					// Individual tool registration logging removed to reduce CLI noise
				} else {
					failed.push({ name: toolName, error: result.message });
					logger.warn(`Failed to register tool ${toolName}: ${result.message}`);
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				failed.push({ name: toolName, error: errorMessage });
				logger.error(`Error registering tool ${toolName}: ${errorMessage}`);
			}
		}

		const result = {
			registered,
			failed,
			total: Object.keys(tools).length,
		};

		// Consolidated tool registration summary (only show if failures occurred)
		if (result.failed.length > 0) {
			logger.debug('Tool registration completed', {
				totalTools: result.total,
				successfullyRegistered: result.registered.length,
				failed: result.failed.length,
				embeddingEnabled: options.embeddingEnabled,
			});
		}

		return result;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error('Failed to register tools', { error: errorMessage });
		throw new Error(`Failed to register tools: ${errorMessage}`);
	}
}

/**
 * Tool category information for documentation and discovery
 */
export const TOOL_CATEGORIES = {
	memory: {
		description: 'Tools for managing facts, memories, knowledge storage, and reasoning patterns',
		tools: [
			'extract_and_operate_memory',
			'memory_search',
			'store_reasoning_memory',
			'extract_reasoning_steps',
			'evaluate_reasoning',
			'search_reasoning_patterns',
		] as string[],
		useCase:
			'Use these tools to capture, search, and store important information and reasoning patterns for future reference',
	},
	knowledge_graph: {
		description: 'Tools for managing and querying knowledge graphs',
		tools: [
			'add_node',
			'add_edge',
			'search_graph',
			'get_neighbors',
			'extract_entities',
			'update_node',
			'delete_node',
			'query_graph',
			'intelligent_processor',
			'enhanced_search',
			'relationship_manager',
		] as string[],
		useCase:
			'Use these tools to build, query, and manage knowledge graphs for understanding relationships between entities',
	},
};

/**
 * Get tool information by name
 */
export function getToolInfo(toolName: string): {
	category: string;
	description: string;
	useCase: string;
} | null {
	// Normalize the tool name (remove cipher_ prefix if present)
	const normalizedName = toolName.replace(/^cipher_/, '');

	for (const [categoryName, categoryInfo] of Object.entries(TOOL_CATEGORIES)) {
		if (categoryInfo.tools.includes(normalizedName)) {
			return {
				category: categoryName,
				description: categoryInfo.description,
				useCase: categoryInfo.useCase,
			};
		}
	}

	return null;
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: keyof typeof TOOL_CATEGORIES): string[] {
	const categoryInfo = TOOL_CATEGORIES[category];
	if (!categoryInfo) {
		return [];
	}

	// Return tool names with cipher_ prefix as they appear in the system
	return categoryInfo.tools.map(toolName => `cipher_${toolName}`);
}
