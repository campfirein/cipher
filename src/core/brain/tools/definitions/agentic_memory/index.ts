/**
 * Agentic Memory Tools
 *
 * Tool definitions for interacting with the agentic memory system through cipher's tool system
 */

import { addMemoryNoteTool } from './add-memory-note.js';
import { searchAgenticMemoryTool } from './search-agentic-memory.js';
import { getMemoryBoxesTool } from './get-memory-boxes.js';

/**
 * All agentic memory tools (temporarily reduced to working tools)
 */
export const agenticMemoryTools = [addMemoryNoteTool, searchAgenticMemoryTool, getMemoryBoxesTool];

/**
 * Tool categories for organization
 */
export const TOOL_CATEGORIES = {
	MEMORY_OPERATIONS: 'memory_operations',
	MEMORY_SEARCH: 'memory_search',
	MEMORY_EVOLUTION: 'memory_evolution',
	MEMORY_ANALYTICS: 'memory_analytics',
	MEMORY_MANAGEMENT: 'memory_management',
} as const;

/**
 * Tool names for easy reference
 */
export const TOOL_NAMES = {
	ADD_MEMORY_NOTE: 'add_memory_note',
	SEARCH_AGENTIC_MEMORY: 'search_agentic_memory',
	EVOLVE_MEMORY: 'evolve_memory',
	GET_MEMORY_RELATIONSHIPS: 'get_memory_relationships',
	CONSOLIDATE_MEMORIES: 'consolidate_memories',
	UPDATE_MEMORY_NOTE: 'update_memory_note',
	DELETE_MEMORY_NOTE: 'delete_memory_note',
	MEMORY_ANALYTICS: 'memory_analytics',
} as const;

/**
 * Export individual tools
 */
export { addMemoryNoteTool, searchAgenticMemoryTool, getMemoryBoxesTool };
