/**
 * Get Memory Relationships Tool
 *
 * Tool for retrieving memory relationships and connections
 */

import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
import { AgenticMemorySystem } from '../../../../agentic_memory/index.js';

/**
 * Get Memory Relationships Tool
 *
 * This tool enables retrieving memory relationships and connections for a specific memory.
 * It can traverse relationship graphs to find indirect connections.
 */
export const getMemoryRelationshipsTool: InternalTool = {
	name: 'get_memory_relationships',
	category: 'memory',
	internal: true,
	agentAccessible: true,
	description:
		'Get relationships and connections for a specific memory, including linked memories and their details.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			memoryId: {
				type: 'string',
				description: 'The ID of the memory to get relationships for',
				minLength: 1,
			},
			includeNeighborDetails: {
				type: 'boolean',
				description: 'Whether to include details of neighbor memories',
				default: true,
			},
			maxDepth: {
				type: 'number',
				description: 'Maximum depth to traverse relationships',
				minimum: 1,
				maximum: 3,
				default: 1,
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
			const { memoryId, includeNeighborDetails = true, maxDepth = 1 } = args;

			const memorySystem = context.services?.agenticMemory as AgenticMemorySystem;
			if (!memorySystem) {
				return {
					success: false,
					memoryId,
					relationships: [],
					totalRelationships: 0,
					message: 'Agentic memory system not available',
				};
			}

			const memory = memorySystem.getMemory(memoryId);
			if (!memory) {
				return {
					success: false,
					memoryId,
					relationships: [],
					totalRelationships: 0,
					message: 'Memory not found',
				};
			}

			const relationships: Array<{
				targetId: string;
				targetContent?: string;
				targetTags?: string[];
				targetCategory?: string;
				depth: number;
			}> = [];
			const visited = new Set<string>();

			const traverse = (currentId: string, depth: number) => {
				if (depth > maxDepth || visited.has(currentId)) return;
				visited.add(currentId);

				const currentMemory = memorySystem.getMemory(currentId);
				if (!currentMemory) return;

				for (const linkId of currentMemory.links) {
					if (!visited.has(linkId)) {
						const linkedMemory = memorySystem.getMemory(linkId);
						if (linkedMemory) {
							const relationship: any = {
								targetId: linkId,
								depth,
							};
							if (includeNeighborDetails) {
								relationship.targetContent = linkedMemory.content;
								relationship.targetTags = linkedMemory.tags;
								relationship.targetCategory = linkedMemory.category;
							}
							relationships.push(relationship);

							if (depth < maxDepth) {
								traverse(linkId, depth + 1);
							}
						}
					}
				}
			};

			traverse(memoryId, 1);

			return {
				success: true,
				memoryId,
				relationships,
				totalRelationships: relationships.length,
				message: 'Relationships retrieved successfully',
			};
		} catch (error) {
			logger.error('Get memory relationships tool failed', { error });
			return {
				success: false,
				memoryId: args.memoryId,
				relationships: [],
				totalRelationships: 0,
				message: `Failed to get relationships: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	},
};
