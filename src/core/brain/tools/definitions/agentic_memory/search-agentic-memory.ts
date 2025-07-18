/**
 * Search Agentic Memory Tool
 *
 * Tool for searching memories in the agentic memory system
 */

import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
import { AgenticMemorySystem } from '../../../../agentic_memory/index.js';

/**
 * Search Agentic Memory Tool
 *
 * This tool enables searching through the agentic memory system.
 * It supports filtering by category, tags, and similarity thresholds.
 */
export const searchAgenticMemoryTool: InternalTool = {
	name: 'search_agentic_memory',
	category: 'memory',
	internal: true,
	agentAccessible: true,
	description:
		'Search through the A-MEM agentic memory system with automatic neighbor inclusion and box-based retrieval.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'The search query',
				minLength: 1,
			},
			maxResults: {
				type: 'number',
				description: 'Maximum number of results to return',
				minimum: 1,
				maximum: 100,
				default: 10,
			},
			includeNeighbors: {
				type: 'boolean',
				description:
					'Whether to include linked neighbor memories (A-MEM automatically includes neighbors)',
				default: true,
			},
			similarityThreshold: {
				type: 'number',
				description: 'Minimum similarity threshold for results',
				minimum: 0,
				maximum: 1,
				default: 0.5,
			},
			category: {
				type: 'string',
				description: 'Optional category filter',
			},
			tags: {
				type: 'array',
				items: { type: 'string' },
				description: 'Optional tags filter',
			},
		},
		required: ['query'],
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
				query,
				maxResults = 10,
				includeNeighbors = true,
				similarityThreshold = 0.5,
				category,
				tags,
			} = args;

			// Get the agentic memory system from context
			const memorySystem = context.services?.agenticMemory as AgenticMemorySystem;
			if (!memorySystem) {
				return {
					success: false,
					message: 'Agentic memory system not available',
				};
			}

			// Search memories
			const searchResults = await memorySystem.searchMemories(query, {
				k: maxResults,
				includeNeighbors,
				similarityThreshold,
			});

			// Apply filters
			let filteredResults = searchResults;

			// Filter by category
			if (category) {
				filteredResults = filteredResults.filter(result =>
					result.memory.category.toLowerCase().includes(category.toLowerCase())
				);
			}

			// Filter by tags
			if (tags && tags.length > 0) {
				filteredResults = filteredResults.filter(result =>
					tags.some((tag: string) =>
						result.memory.tags.some(memoryTag =>
							memoryTag.toLowerCase().includes(tag.toLowerCase())
						)
					)
				);
			}

			// Format results
			const results = filteredResults.map(result => ({
				memoryId: result.memory.id,
				content: result.memory.content,
				keywords: result.memory.keywords,
				context: result.memory.context,
				tags: result.memory.tags,
				category: result.memory.category,
				timestamp: result.memory.timestamp,
				score: result.score,
				isNeighbor: result.isNeighbor,
				relevance: result.relevance,
			}));

			return {
				success: true,
				results,
				totalResults: results.length,
				query,
				message: `Found ${results.length} memories matching the query`,
			};
		} catch (error) {
			logger.error('Search agentic memory tool failed', { error });
			return {
				success: false,
				message: `Failed to search memories: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	},
};
