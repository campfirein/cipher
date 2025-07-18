/**
 * Consolidate Memories Tool
 *
 * Tool for triggering memory consolidation and batch processing
 */

import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
import { AgenticMemorySystem } from '../../../../agentic_memory/index.js';

/**
 * Consolidate Memories Tool
 *
 * This tool triggers memory consolidation and batch processing in the agentic memory system.
 * It helps organize and optimize memory relationships.
 */
export const consolidateMemoriesTool: InternalTool = {
	name: 'consolidate_memories',
	category: 'memory',
	internal: true,
	agentAccessible: true,
	description:
		'Trigger memory consolidation and batch processing to optimize memory relationships.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			force: {
				type: 'boolean',
				description: 'Whether to force consolidation regardless of threshold',
				default: false,
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
			const { force = false } = args;
			// Note: force parameter is currently not used in consolidateMemories() but kept for API compatibility

			// Get the agentic memory system from context
			const memorySystem = context.services?.agenticMemory as AgenticMemorySystem;
			if (!memorySystem) {
				return {
					success: false,
					message: 'Agentic memory system not available',
				};
			}

			// Trigger consolidation
			const result = await memorySystem.consolidateMemories();

			return {
				success: true,
				processedCount: result.processedCount,
				newRelationships: result.newRelationships,
				evolvedCount: result.evolvedCount,
				processingTime: result.processingTime,
				errors: result.errors,
				message: `Consolidation completed: processed ${result.processedCount} memories, created ${result.newRelationships} relationships, evolved ${result.evolvedCount} memories`,
			};
		} catch (error) {
			logger.error('Consolidate memories tool failed', { error });
			return {
				success: false,
				message: `Failed to consolidate memories: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	},
};
