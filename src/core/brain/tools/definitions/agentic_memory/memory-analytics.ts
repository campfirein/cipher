/**
 * Memory Analytics Tool
 *
 * Tool for getting analytics and statistics about the agentic memory system
 */

import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
import { AgenticMemorySystem } from '../../../../agentic_memory/index.js';

/**
 * Memory Analytics Tool
 *
 * This tool provides comprehensive analytics and statistics about the agentic memory system
 * including memory counts, usage patterns, evolution statistics, and system health.
 */
export const memoryAnalyticsTool: InternalTool = {
	name: 'memory_analytics',
	category: 'memory',
	internal: true,
	agentAccessible: true,
	description:
		'Get comprehensive analytics and statistics about the agentic memory system including memory counts, usage patterns, evolution statistics, and system health.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			includeTopMemories: {
				type: 'boolean',
				description: 'Whether to include top accessed memories',
				default: true,
			},
			topMemoriesLimit: {
				type: 'number',
				description: 'Number of top memories to include',
				minimum: 1,
				maximum: 50,
				default: 10,
			},
			includeCategoryDistribution: {
				type: 'boolean',
				description: 'Whether to include category distribution',
				default: true,
			},
			includeTagDistribution: {
				type: 'boolean',
				description: 'Whether to include tag distribution',
				default: true,
			},
			includeEvolutionStats: {
				type: 'boolean',
				description: 'Whether to include evolution statistics',
				default: true,
			},
			includeSystemStatus: {
				type: 'boolean',
				description: 'Whether to include system status',
				default: true,
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
			const {
				includeTopMemories = true,
				topMemoriesLimit = 10,
				includeCategoryDistribution = true,
				includeTagDistribution = true,
				includeEvolutionStats = true,
				includeSystemStatus = true,
			} = args;

			// Get the agentic memory system from context
			const memorySystem = context.services?.agenticMemory as AgenticMemorySystem;
			if (!memorySystem) {
				return {
					success: false,
					message: 'Agentic memory system not available',
					analytics: {
						totalMemories: 0,
						totalRelationships: 0,
						avgRetrievalCount: 0,
					},
					generatedAt: new Date().toISOString(),
				};
			}

			// Get analytics from the memory system
			const systemAnalytics = memorySystem.getAnalytics();
			const systemStatus = includeSystemStatus ? memorySystem.getStatus() : undefined;

			// Build the analytics response
			const analytics: any = {
				totalMemories: systemAnalytics.totalMemories,
				totalRelationships: systemAnalytics.totalRelationships,
				avgRetrievalCount: systemAnalytics.avgRetrievalCount,
			};

			// Add top memories if requested
			if (includeTopMemories && systemAnalytics.topMemories.length > 0) {
				analytics.topMemories = systemAnalytics.topMemories
					.slice(0, topMemoriesLimit)
					.map((memory: any) => ({
						id: memory.id,
						content:
							memory.content.length > 100
								? memory.content.substring(0, 100) + '...'
								: memory.content,
						retrievalCount: memory.retrievalCount,
						keywords: memory.keywords,
						tags: memory.tags,
						category: memory.category,
						links: memory.links,
					}));
			}

			// Add category distribution if requested
			if (includeCategoryDistribution) {
				analytics.categoryDistribution = systemAnalytics.categoryDistribution;
			}

			// Add tag distribution if requested
			if (includeTagDistribution) {
				analytics.tagDistribution = systemAnalytics.tagDistribution;
			}

			// Add evolution stats if requested
			if (includeEvolutionStats) {
				analytics.evolutionStats = systemAnalytics.evolutionStats;
			}

			// Add system status if requested
			if (includeSystemStatus && systemStatus) {
				analytics.systemStatus = {
					connected: systemStatus.connected,
					memoryCount: systemStatus.memoryCount,
					evolutionCounter: systemStatus.evolutionCounter,
					lastEvolution: systemStatus.lastEvolution,
					health: systemStatus.health,
				};
			}

			return {
				success: true,
				message: 'Analytics retrieved successfully',
				analytics,
				generatedAt: new Date().toISOString(),
			};
		} catch (error) {
			logger.error('Memory analytics tool failed', { error });
			return {
				success: false,
				message: `Failed to get analytics: ${error instanceof Error ? error.message : String(error)}`,
				analytics: {
					totalMemories: 0,
					totalRelationships: 0,
					avgRetrievalCount: 0,
				},
				generatedAt: new Date().toISOString(),
			};
		}
	},
};
