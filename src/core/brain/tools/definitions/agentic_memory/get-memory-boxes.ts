/**
 * Get Memory Boxes Tool
 *
 * Tool for retrieving memory box information from the A-MEM system
 */

import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
import { AgenticMemorySystem } from '../../../../agentic_memory/index.js';

/**
 * Get Memory Boxes Tool
 *
 * This tool enables retrieving information about memory boxes in the A-MEM system.
 * Memory boxes group related memories following the Zettelkasten methodology.
 */
export const getMemoryBoxesTool: InternalTool = {
	name: 'get_memory_boxes',
	category: 'memory',
	internal: true,
	agentAccessible: true,
	description:
		'Get information about memory boxes in the A-MEM system. Boxes group related memories following Zettelkasten methodology.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			memoryId: {
				type: 'string',
				description: 'Optional memory ID to get boxes for a specific memory',
			},
			includeMemoryIds: {
				type: 'boolean',
				description: 'Whether to include memory IDs in each box',
				default: true,
			},
			minCoherenceScore: {
				type: 'number',
				description: 'Minimum coherence score for boxes to include',
				minimum: 0,
				maximum: 1,
				default: 0,
			},
		},
		required: [],
	},
	handler: async (args: any, context: InternalToolContext | undefined) => {
		if (!context) {
			return {
				success: false,
				message: 'Tool context is required',
			};
		}

		try {
			const { memoryId, includeMemoryIds = true, minCoherenceScore = 0 } = args;

			// Get the agentic memory system from context
			const memorySystem = context.services?.agenticMemory as AgenticMemorySystem;
			if (!memorySystem) {
				return {
					success: false,
					message: 'Agentic memory system not available',
				};
			}

			let boxes: any[] = [];

			if (memoryId) {
				// Get boxes for specific memory
				const memory = memorySystem.getMemory(memoryId);
				if (!memory) {
					return {
						success: false,
						message: `Memory with ID ${memoryId} not found`,
					};
				}

				// Access the box manager through the memory system (this would need to be exposed)
				// For now, we'll return box information through the memory's relationships
				const relatedMemories = memory.links.length;

				return {
					success: true,
					memoryId,
					message: `Memory ${memoryId} has ${relatedMemories} related memories`,
					relatedMemories,
					links: memory.links,
				};
			} else {
				// Get all boxes - this would need the box manager to be exposed in the memory system
				// For now, return a summary of memory relationships
				const analytics = memorySystem.getAnalytics();

				return {
					success: true,
					message: 'Memory system analytics retrieved',
					totalMemories: analytics.totalMemories,
					totalRelationships: analytics.totalRelationships,
					categoryDistribution: analytics.categoryDistribution,
					tagDistribution: analytics.tagDistribution,
					topMemories: analytics.topMemories.slice(0, 5).map(m => ({
						id: m.id,
						retrievalCount: m.retrievalCount,
						linksCount: m.links.length,
						context: m.context,
						tags: m.tags,
					})),
				};
			}
		} catch (error) {
			logger.error('Get memory boxes tool failed', { error });
			return {
				success: false,
				message: `Failed to get memory boxes: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	},
};
