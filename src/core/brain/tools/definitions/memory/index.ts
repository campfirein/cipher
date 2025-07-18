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

// Import reasoning tools from reflective memory module
import {
	extractReasoningSteps,
	evaluateReasoning,
	searchReasoningPatterns,
} from '../../def_reflective_memory_tools.js';

// Import types
import type { InternalTool } from '../../types.js';

// Export individual tools
export {
	extractAndOperateMemoryTool,
	searchMemoryTool,
	storeReasoningMemoryTool,
	extractReasoningSteps,
	evaluateReasoning,
	searchReasoningPatterns,
};

// Array of all memory tools (dynamic based on LLM context)
export async function getMemoryToolsArray(): Promise<InternalTool[]> {
	const toolMap = await getAllMemoryToolDefinitions();
	return Object.values(toolMap);
}

// Load tools dynamically to avoid potential circular dependencies
// import('./extract-knowledge.js').then(module => memoryTools.push(module.extractKnowledgeTool));
// import('./memory_operation.js').then(module => memoryTools.push(module.memoryOperationTool));

/**
 * Get all memory tools as a map
 */
export async function getMemoryTools(): Promise<Record<string, InternalTool>> {
	return {
		cipher_extract_and_operate_memory: extractAndOperateMemoryTool,
		cipher_memory_search: searchMemoryTool,
		cipher_store_reasoning_memory: storeReasoningMemoryTool,
		cipher_extract_reasoning_steps: extractReasoningSteps,
		cipher_evaluate_reasoning: evaluateReasoning,
		cipher_search_reasoning_patterns: searchReasoningPatterns,
	};
}

/**
 * Get memory tool definitions for registration
 */
export async function getAllMemoryToolDefinitions(): Promise<Record<string, InternalTool>> {
	// Base tools always available
	const tools: Record<string, InternalTool> = {
		extract_and_operate_memory: extractAndOperateMemoryTool,
		memory_search: searchMemoryTool,
		store_reasoning_memory: storeReasoningMemoryTool,
		// All reasoning tools are always available for testing and functionality
		extract_reasoning_steps: extractReasoningSteps,
		evaluate_reasoning: evaluateReasoning,
		search_reasoning_patterns: searchReasoningPatterns,
	};

	return tools;
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
	// extract_knowledge: { ... },
	// memory_operation: { ... },
} as const;
