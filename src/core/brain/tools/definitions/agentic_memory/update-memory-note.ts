/**
 * Update Memory Note Tool
 *
 * Tool for updating existing memory notes
 */

import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
import { AgenticMemorySystem } from '../../../../agentic_memory/index.js';

/**
 * Update Memory Note Tool
 *
 * This tool enables updating existing memory notes with new content, keywords, tags, or other metadata.
 */
export const updateMemoryNoteTool: InternalTool = {
	name: 'update_memory_note',
	category: 'memory',
	internal: true,
	agentAccessible: true,
	description:
		'Update an existing memory note with new content, keywords, tags, or other metadata.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			memoryId: {
				type: 'string',
				description: 'The ID of the memory to update',
				minLength: 1,
			},
			content: {
				type: 'string',
				description: 'New content for the memory',
			},
			keywords: {
				type: 'array',
				items: { type: 'string' },
				description: 'New keywords for the memory',
			},
			context: {
				type: 'string',
				description: 'New context for the memory',
			},
			tags: {
				type: 'array',
				items: { type: 'string' },
				description: 'New tags for the memory',
			},
			category: {
				type: 'string',
				description: 'New category for the memory',
			},
			metadata: {
				type: 'object',
				description: 'New metadata for the memory',
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
			const {
				memoryId,
				content,
				keywords,
				context: memoryContext,
				tags,
				category,
				metadata,
			} = args;

			const memorySystem = context.services?.agenticMemory as AgenticMemorySystem;
			if (!memorySystem) {
				return {
					success: false,
					memoryId,
					message: 'Agentic memory system not available',
					updatedFields: [],
				};
			}

			const updates: any = {};
			const updatedFields: string[] = [];

			if (content !== undefined) {
				updates.content = content;
				updatedFields.push('content');
			}
			if (keywords !== undefined) {
				updates.keywords = keywords;
				updatedFields.push('keywords');
			}
			if (memoryContext !== undefined) {
				updates.context = memoryContext;
				updatedFields.push('context');
			}
			if (tags !== undefined) {
				updates.tags = tags;
				updatedFields.push('tags');
			}
			if (category !== undefined) {
				updates.category = category;
				updatedFields.push('category');
			}
			if (metadata !== undefined) {
				updates.metadata = metadata;
				updatedFields.push('metadata');
			}

			if (updatedFields.length === 0) {
				return {
					success: false,
					memoryId,
					message: 'No fields to update',
					updatedFields: [],
				};
			}

			const success = await memorySystem.updateMemory(memoryId, updates);

			return {
				success,
				memoryId,
				message: success ? 'Memory updated successfully' : 'Memory not found or update failed',
				updatedFields: success ? updatedFields : [],
			};
		} catch (error) {
			logger.error('Update memory note tool failed', { error });
			return {
				success: false,
				memoryId: args.memoryId,
				message: `Failed to update memory note: ${error instanceof Error ? error.message : String(error)}`,
				updatedFields: [],
			};
		}
	},
};
