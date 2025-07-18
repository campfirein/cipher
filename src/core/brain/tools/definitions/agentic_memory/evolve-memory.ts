/**
 * Evolve Memory Tool
 *
 * Tool for manually triggering memory evolution in the agentic memory system
 */

import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
import { AgenticMemorySystem } from '../../../../agentic_memory/index.js';

/**
 * Evolve Memory Tool
 *
 * This tool enables manually triggering memory evolution for a specific memory.
 * It analyzes the memory and its relationships to determine if evolution should occur.
 */
export const evolveMemoryTool: InternalTool = {
	name: 'evolve_memory',
	category: 'memory',
	internal: true,
	agentAccessible: true,
	description:
		'Manually trigger memory evolution for a specific memory. This will analyze the memory and its relationships to determine if evolution should occur.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			memoryId: {
				type: 'string',
				description: 'The ID of the memory to evolve',
				minLength: 1,
			},
			forceEvolution: {
				type: 'boolean',
				description: 'Whether to force evolution even if conditions are not met',
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
			const { memoryId, forceEvolution = false } = args;

			// Get the agentic memory system from context
			const memorySystem = context.services?.agenticMemory as AgenticMemorySystem;
			if (!memorySystem) {
				return {
					success: false,
					memoryId,
					evolutionTriggered: false,
					message: 'Agentic memory system not available',
				};
			}

			// Get the memory to evolve
			const memory = memorySystem.getMemory(memoryId);
			if (!memory) {
				return {
					success: false,
					memoryId,
					evolutionTriggered: false,
					message: 'Memory not found',
				};
			}

			// Get the current evolution count
			const initialEvolutionCount = memory.evolutionHistory.length;

			// For manual evolution, we need to trigger consolidation which will process evolution
			const consolidationResult = await memorySystem.consolidateMemories();

			// Check if the specific memory evolved
			const updatedMemory = memorySystem.getMemory(memoryId);
			if (!updatedMemory) {
				return {
					success: false,
					memoryId,
					evolutionTriggered: false,
					message: 'Memory not found after consolidation',
				};
			}

			const evolutionTriggered = updatedMemory.evolutionHistory.length > initialEvolutionCount;

			let evolutionDetails;
			if (evolutionTriggered) {
				const latestEvolution = updatedMemory.getLatestEvolution();
				if (latestEvolution) {
					evolutionDetails = {
						type: latestEvolution.type,
						timestamp: latestEvolution.timestamp,
						description: latestEvolution.description,
						involvedMemories: latestEvolution.involvedMemories,
						changes: latestEvolution.changes,
					};
				}
			}

			return {
				success: true,
				memoryId,
				evolutionTriggered,
				message: evolutionTriggered
					? 'Memory evolution completed successfully'
					: 'Memory evolution was not triggered (no suitable conditions found)',
				evolutionDetails,
				updatedMemory: {
					id: updatedMemory.id,
					content: updatedMemory.content,
					keywords: updatedMemory.keywords,
					context: updatedMemory.context,
					tags: updatedMemory.tags,
					links: updatedMemory.links,
					evolutionHistory: updatedMemory.evolutionHistory.map((e: any) => ({
						timestamp: e.timestamp,
						type: e.type,
						description: e.description,
					})),
				},
			};
		} catch (error) {
			logger.error('Evolve memory tool failed', { error });
			return {
				success: false,
				memoryId: args.memoryId,
				evolutionTriggered: false,
				message: `Failed to evolve memory: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	},
};
