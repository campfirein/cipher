/**
 * Query Graph Tool
 *
 * Executes custom queries against the knowledge graph.
 * Supports different query types including Cypher-like queries and structured queries.
 */

import { InternalTool, InternalToolContext } from '../../types.js';
import type { GraphQuery } from '../../../../knowledge_graph/backend/types.js';

/**
 * Query graph tool for executing custom queries against the knowledge graph
 */
export const queryGraphTool: InternalTool = {
	name: 'query_graph',
	category: 'knowledge_graph',
	internal: true,
	// FIX: Updated description to mention backend limitations
	description: 'Execute custom queries against the knowledge graph. ' +
	             'NOTE: Cypher queries require Neo4j backend. In-memory backend supports node, edge, and path queries only.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'Query string (Cypher-like syntax or structured query)',
			},
			queryType: {
				type: 'string',
				enum: ['node', 'edge', 'path', 'cypher'],
				description: 'Type of query to execute',
				default: 'cypher',
			},
			parameters: {
				type: 'object',
				description: 'Query parameters for parameterized queries',
				additionalProperties: true,
			},
			limit: {
				type: 'number',
				description: 'Maximum number of results to return',
				minimum: 1,
				maximum: 1000,
				default: 100,
			},
		},
		required: ['query'],
	},
	handler: async (
		args: {
			query: string;
			queryType?: 'node' | 'edge' | 'path' | 'cypher';
			parameters?: Record<string, any>;
			limit?: number;
		},
		context?: InternalToolContext
	) => {
		try {
			const queryType = args.queryType || 'cypher';
			const limit = args.limit !== undefined ? args.limit : 100;
			if (!args.query || typeof args.query !== 'string' || args.query.trim().length === 0) {
				throw new Error('Query is required and must be a non-empty string');
			}
			if (limit < 1 || limit > 1000) {
				return {
					success: false,
					message: 'Limit must be between 1 and 1000',
					results: null,
					timestamp: new Date().toISOString(),
				};
			}
			const kgManager = context?.services?.knowledgeGraphManager;
			if (!kgManager) {
				return {
					success: false,
					message: 'KnowledgeGraphManager not available in context.services',
					results: null,
					timestamp: new Date().toISOString(),
				};
			}
			const graph = kgManager.getGraph();
			if (!graph) {
				return {
					success: false,
					message: 'Knowledge graph backend is not connected',
					results: null,
					timestamp: new Date().toISOString(),
				};
			}
			// FIX (2025-01-29): Added backend validation for Cypher queries
			// In-memory backend doesn't support Cypher query language
			// This provides a clear error message and suggests alternatives
			if (queryType === 'cypher') {
				// Check if backend supports Cypher (Neo4j) or is in-memory
				const backendType = kgManager.getBackendType ? kgManager.getBackendType() : 'memory';

				if (backendType === 'memory' || backendType === 'in-memory') {
					return {
						success: false,
						message: 'Cypher queries require Neo4j backend. Current backend: in-memory. ' +
						        'Use queryType: "node", "edge", or "path" instead, or enable Neo4j in configuration.',
						alternatives: ['node', 'edge', 'path'],
						example: 'For node search, use: queryType: "node" with query: "labels: [Person]"',
						results: null,
						timestamp: new Date().toISOString(),
					};
				}
			}

			const graphQuery: GraphQuery = {
				type: queryType,
				parameters: args.parameters || {},
				limit,
			};
			if (queryType === 'cypher') {
				graphQuery.query = args.query.trim();
			} else {
				// Structured query: parse pattern from query string if possible
				const pattern: any = {};
				if (args.query.includes('labels:')) {
					const labelsMatch = args.query.match(/labels:\s*\[([^\]]+)\]/);
					if (labelsMatch && labelsMatch[1]) {
						pattern.labels = labelsMatch[1].split(',').map(l => l.trim().replace(/['"]/g, ''));
					}
				}
				if (args.query.includes('type:')) {
					// Match quoted or unquoted values
					const typeMatch = args.query.match(/type:\s*(?:['"]([^'"]+)['"]|([A-Z_][A-Z0-9_]*))/);
					if (typeMatch) {
						pattern.type = typeMatch[1] || typeMatch[2]; // Use quoted value if present, otherwise unquoted
					}
				}
				graphQuery.pattern = pattern;
			}
			const result = await graph.query(graphQuery);
			return {
				success: true,
				results: result,
				query: {
					original: args.query,
					type: queryType,
					parameters: args.parameters || {},
					limit,
				},
				message: 'Query executed',
				timestamp: new Date().toISOString(),
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: errorMessage,
				results: {
					nodes: [],
					edges: [],
					metadata: {
						totalCount: 0,
						queryType: args.queryType || 'cypher',
					},
				},
				timestamp: new Date().toISOString(),
			};
		}
	},
};
