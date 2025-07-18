/**
 * Add Memory Note Tool
 *
 * Tool for adding new memory notes to the agentic memory system
 */

import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
import { AgenticMemorySystem } from '../../../../agentic_memory/index.js';

/**
 * Add Memory Note Tool
 *
 * This tool enables adding new memory notes to the agentic memory system.
 * It automatically analyzes content and may trigger memory evolution.
 */
export const addMemoryNoteTool: InternalTool = {
	name: 'add_memory_note',
	category: 'memory',
	internal: true,
	agentAccessible: true,
	description:
		'Add a new memory note to the A-MEM agentic memory system. The system will automatically analyze content, generate links, organize into boxes, and may trigger memory evolution.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			content: {
				type: 'string',
				description: 'The content of the memory note',
				minLength: 10,
				maxLength: 50000,
			},
			keywords: {
				type: 'array',
				items: { type: 'string' },
				description: 'Optional keywords for the memory',
			},
			context: {
				type: 'string',
				description: 'Optional context for the memory',
			},
			tags: {
				type: 'array',
				items: { type: 'string' },
				description: 'Optional tags for categorization',
			},
			category: {
				type: 'string',
				description: 'Optional category for the memory',
			},
			metadata: {
				type: 'object',
				description: 'Optional additional metadata',
			},
			timestamp: {
				type: 'string',
				description: 'Optional timestamp in YYYYMMDDHHMM format',
			},
		},
		required: ['content'],
	},
	handler: async (args: any, context: InternalToolContext | undefined) => {
		if (!context) {
			return {
				success: false,
				message: 'Tool context is required',
			};
		}

		try {
			const {
				content,
				keywords,
				context: memoryContext,
				tags,
				category,
				metadata,
				timestamp,
			} = args;

			// Get the agentic memory system from context
			const memorySystem = context.services?.agenticMemory as AgenticMemorySystem;
			if (!memorySystem) {
				return {
					success: false,
					message: 'Agentic memory system not available',
				};
			}

			// Add the memory note
			const memoryId = await memorySystem.addMemory(content, {
				keywords,
				context: memoryContext,
				tags,
				category,
				metadata,
				timestamp,
			});

			// Get the created memory to return analysis results
			const memory = memorySystem.getMemory(memoryId);
			if (!memory) {
				return {
					success: false,
					message: 'Memory was created but could not be retrieved',
				};
			}

			// Check if evolution was triggered by looking at evolution history
			const evolutionTriggered = memory.hasEvolved();
			const linksCount = memory.links.length;

			return {
				success: true,
				memoryId,
				message: `Memory note added successfully with A-MEM processing. Generated ${linksCount} links.`,
				analyzedKeywords: memory.keywords,
				analyzedContext: memory.context,
				analyzedTags: memory.tags,
				linksGenerated: linksCount,
				evolutionTriggered,
			};
		} catch (error) {
			logger.error('Add memory note tool failed', { error });
			return {
				success: false,
				message: `Failed to add memory note: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	},
};
