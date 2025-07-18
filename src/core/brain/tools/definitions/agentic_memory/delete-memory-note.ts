/**
 * Delete Memory Note Tool
 *
 * Tool for deleting memory notes from the agentic memory system
 */

import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
import { AgenticMemorySystem } from '../../../../agentic_memory/index.js';

/**
 * Delete Memory Note Tool
 *
 * This tool enables deleting memory notes from the agentic memory system.
 * It will also remove all links to the deleted memory from other memories.
 */
export const deleteMemoryNoteTool: InternalTool = {
	name: 'delete_memory_note',
	category: 'memory',
	internal: true,
	agentAccessible: true,
	description:
		'Delete a memory note from the agentic memory system. This will also remove all links to the deleted memory from other memories.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			memoryId: {
				type: 'string',
				description: 'The ID of the memory note to delete',
				minLength: 1,
			},
			confirmDeletion: {
				type: 'boolean',
				description: 'Confirmation that you want to delete the memory',
				default: false,
			},
		},
		required: ['memoryId'],
	},
	handler: async (args: any, context: InternalToolContext | undefined) => {
		if (!context) {
			return {
				success: false,
				message: 'Tool context is required',
			};
		}

		try {
			const { memoryId, confirmDeletion = false } = args;

			if (!confirmDeletion) {
				return {
					success: false,
					memoryId,
					message: 'Deletion not confirmed. Set confirmDeletion to true to delete the memory.',
				};
			}

			// Get the agentic memory system from context
			const memorySystem = context.services?.agenticMemory as AgenticMemorySystem;
			if (!memorySystem) {
				return {
					success: false,
					memoryId,
					message: 'Agentic memory system not available',
				};
			}

			// Get the memory to count relationships before deletion
			const memory = memorySystem.getMemory(memoryId);
			const removedRelationships = memory ? memory.links.length : 0;

			// Delete the memory
			const deleted = await memorySystem.deleteMemory(memoryId);

			if (deleted) {
				return {
					success: true,
					memoryId,
					message: 'Memory deleted successfully',
					removedRelationships,
				};
			} else {
				return {
					success: false,
					memoryId,
					message: 'Memory not found or deletion failed',
				};
			}
		} catch (error) {
			logger.error('Delete memory note tool failed', { error });
			return {
				success: false,
				memoryId: args.memoryId,
				message: `Failed to delete memory note: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	},
};
