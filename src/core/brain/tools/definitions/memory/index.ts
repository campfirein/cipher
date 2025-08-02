/**
 * Memory Tools Module
 *
 * This module exports all memory-related internal tools for the Cipher agent.
 * These tools handle fact extraction, knowledge processing, memory operations, and memory search.
 */

// Export all memory tools
// export { extractKnowledgeTool } from './extract-knowledge.js';
// export { memoryOperationTool } from './memory_operation.js';
import { extractAndOperateMemoryTool } from './extract_and_operate_memory.js';
import { searchMemoryTool } from './search_memory.js';
import { storeReasoningMemoryTool } from './store_reasoning_memory.js';

// Import lazy loading optimized tool
import { lazyExtractAndOperateMemoryTool } from '../../../memory/lazy-extract-and-operate.js';
import { env } from '../../../../env.js';

// Import reasoning tools from reflective memory module
import {
	extractReasoningSteps,
	evaluateReasoning,
	searchReasoningPatterns,
} from '../../def_reflective_memory_tools.js';

// Import workspace memory tools
import {
	getWorkspaceTools,
	getAllWorkspaceToolDefinitions,
	shouldDisableDefaultMemory,
	logWorkspaceMemoryStatus,
	WORKSPACE_TOOL_INFO,
} from './workspace-tools.js';

// Import types
import type { InternalTool } from '../../types.js';
import { logger } from '../../../../logger/index.js';

// Shared constants
const EMBEDDING_DEPENDENT_TOOLS = [
	'cipher_extract_and_operate_memory',
	'cipher_memory_search',
	'cipher_store_reasoning_memory',
	'cipher_search_reasoning_patterns',
	'cipher_workspace_search',
	'cipher_workspace_store',
] as const;

// Export individual tools
export {
	extractAndOperateMemoryTool,
	searchMemoryTool,
	storeReasoningMemoryTool,
	extractReasoningSteps,
	evaluateReasoning,
	searchReasoningPatterns,
};

// Export workspace memory tools
export {
	getWorkspaceTools,
	getAllWorkspaceToolDefinitions,
	shouldDisableDefaultMemory,
	logWorkspaceMemoryStatus,
} from './workspace-tools.js';

// Array of all memory tools (dynamic based on LLM context)
export async function getMemoryToolsArray(
	options: { embeddingEnabled?: boolean } = {}
): Promise<InternalTool[]> {
	const toolMap = await getAllMemoryToolDefinitions(options);
	return Object.values(toolMap);
}

// Load tools dynamically to avoid potential circular dependencies
// import('./extract-knowledge.js').then(module => memoryTools.push(module.extractKnowledgeTool));
// import('./memory_operation.js').then(module => memoryTools.push(module.memoryOperationTool));

/**
 * Get all memory tools as a map
 */
export async function getMemoryTools(
	options: { embeddingEnabled?: boolean } = {}
): Promise<Record<string, InternalTool>> {
	const { embeddingEnabled = true } = options;

	// If embeddings are disabled, exclude all embedding-dependent tools
	if (!embeddingEnabled) {
		logger.warn('Embeddings disabled - excluding all embedding-dependent memory tools', {
			excludedTools: EMBEDDING_DEPENDENT_TOOLS,
		});
		return {};
	}

	// Use lazy version of extract_and_operate_memory if lazy loading is enabled
	const useLazyMemoryTool = env.ENABLE_LAZY_LOADING === 'true';

	const extractAndOperateTool = useLazyMemoryTool
		? lazyExtractAndOperateMemoryTool
		: extractAndOperateMemoryTool;

	// Check if default memory should be disabled when workspace memory is active
	// In test environments, ensure default memory tools are always available unless explicitly disabled
	const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
	const disableDefaultMemory = isTestEnvironment ? false : shouldDisableDefaultMemory();

	// Default memory tools (always include unless explicitly disabled)
	const defaultTools: Record<string, InternalTool> = disableDefaultMemory
		? {}
		: {
				...(env.SEARCH_MEMORY_TYPE !== 'reflection' && {
					// Knowledge or both
					cipher_extract_and_operate_memory: extractAndOperateTool,
					cipher_memory_search: searchMemoryTool,
				}),
				...(env.SEARCH_MEMORY_TYPE !== 'knowledge' && {
					// Reflection or both
					cipher_store_reasoning_memory: storeReasoningMemoryTool,
					cipher_extract_reasoning_steps: extractReasoningSteps,
					cipher_evaluate_reasoning: evaluateReasoning,
					cipher_search_reasoning_patterns: searchReasoningPatterns,
				}),
			};

	// Get workspace memory tools
	const workspaceTools = await getWorkspaceTools(options);

	// If workspace memory is enabled and default memory is disabled, return only workspace tools
	if (disableDefaultMemory && Object.keys(workspaceTools).length > 0) {
		logger.info('Using workspace-only memory mode', {
			workspaceTools: Object.keys(workspaceTools),
		});
		return workspaceTools;
	}

	// Combine default and workspace tools
	return {
		...defaultTools,
		...workspaceTools,
	};
}

/**
 * Get memory tool definitions for registration
 */
export async function getAllMemoryToolDefinitions(
	options: { embeddingEnabled?: boolean } = {}
): Promise<Record<string, InternalTool>> {
	const { embeddingEnabled = true } = options;

	// If embeddings are disabled, return empty tools
	if (!embeddingEnabled) {
		logger.warn('Embeddings disabled - excluding all embedding-dependent memory tools', {
			excludedTools: EMBEDDING_DEPENDENT_TOOLS,
		});
		return {};
	}

	// Log workspace memory status
	logWorkspaceMemoryStatus();

	// Check if default memory should be disabled when workspace memory is active
	// In test environments, ensure default memory tools are always available unless explicitly disabled
	const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
	const disableDefaultMemory = isTestEnvironment ? false : shouldDisableDefaultMemory();

	// Get workspace memory tool definitions
	const workspaceToolDefinitions = await getAllWorkspaceToolDefinitions(options);

	// If workspace memory is enabled and default memory is disabled, return only workspace tools
	if (disableDefaultMemory && Object.keys(workspaceToolDefinitions).length > 0) {
		logger.info('Using workspace-only memory tool definitions', {
			workspaceTools: Object.keys(workspaceToolDefinitions),
		});
		return workspaceToolDefinitions;
	}

	// Use lazy version of extract_and_operate_memory if lazy loading is enabled
	const useLazyMemoryTool = env.ENABLE_LAZY_LOADING === 'true';

	const extractAndOperateTool = useLazyMemoryTool
		? lazyExtractAndOperateMemoryTool
		: extractAndOperateMemoryTool;

	// Default memory tools
	const defaultTools: Record<string, InternalTool> = disableDefaultMemory
		? {}
		: {
				...(env.SEARCH_MEMORY_TYPE !== 'reflection' && {
					// Knowledge or both
					cipher_extract_and_operate_memory: extractAndOperateTool,
					cipher_memory_search: searchMemoryTool,
				}),
				...(env.SEARCH_MEMORY_TYPE !== 'knowledge' && {
					// Reflection or both
					cipher_store_reasoning_memory: storeReasoningMemoryTool,
					// All reasoning tools are always available for testing and functionality
					cipher_extract_reasoning_steps: extractReasoningSteps,
					cipher_evaluate_reasoning: evaluateReasoning,
					cipher_search_reasoning_patterns: searchReasoningPatterns,
				}),
			};

	// Combine default and workspace tool definitions
	return {
		...defaultTools,
		...workspaceToolDefinitions,
	};
}

/**
 * Memory tool categories and descriptions
 */
export const MEMORY_TOOL_INFO = {
	extract_and_operate_memory: {
		category: 'memory',
		purpose:
			'Extract knowledge facts from raw interaction(s) and immediately process them to determine memory operations (ADD, UPDATE, DELETE, NONE) in a single atomic step.',
		useCase:
			'Use when you need to capture important technical information, code patterns, or implementation details and immediately manage memory in a single, atomic operation.',
	},
	memory_search: {
		category: 'memory',
		purpose:
			'Perform semantic search over stored memory entries to retrieve relevant knowledge and reasoning traces that can inform current decision-making.',
		useCase:
			'Use when you need to find previously stored knowledge, code patterns, or technical information that may be relevant to answering current questions or solving problems.',
	},
	store_reasoning_memory: {
		category: 'memory',
		purpose:
			'Store reasoning traces and evaluations in reflection memory for future pattern analysis and reuse. Only stores high-quality reasoning and operates in append-only mode.',
		useCase:
			'Use in background after reasoning is complete to capture successful reasoning patterns for future reference. Only high-quality reasoning is stored.',
	},
	// Workspace memory tools
	...WORKSPACE_TOOL_INFO,
	// extract_knowledge: { ... },
	// memory_operation: { ... },
} as const;
