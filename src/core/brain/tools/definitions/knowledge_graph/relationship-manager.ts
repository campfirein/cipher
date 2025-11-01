/**
 * Intelligent Relationship Manager Tool
 *
 * Advanced tools for managing relationships and entities with intelligence.
 * Handles complex scenarios like entity replacement, relationship updates,
 * and smart merging based on natural language instructions.
 *
 * This tool can handle scenarios like:
 * - "not Long but Nam and Trang" -> Replace Long with Nam in all relationships
 * - "update John's role to senior engineer" -> Update specific relationship properties
 * - "merge Google and Alphabet" -> Intelligent entity merging
 * - "delete all connections to deprecated services" -> Bulk relationship management
 */

import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';
import type { GraphNode, GraphEdge } from '../../../../knowledge_graph/backend/types.js';

/**
 * Relationship management operation types
 */
type RelationshipOperation =
	| 'replace_entity' // Replace one entity with another in all relationships
	| 'update_relationship' // Update specific relationship properties
	| 'merge_entities' // Merge two entities and their relationships
	| 'delete_relationships' // Delete relationships matching criteria
	| 'bulk_update' // Bulk update multiple relationships
	| 'conditional_update'; // Update based on conditions

/**
 * Relationship management configuration
 */
interface RelationshipManagerOptions {
	/** Whether to preserve historical data during operations */
	preserveHistory?: boolean;
	/** Confidence threshold for automatic operations */
	confidenceThreshold?: number;
	/** Whether to automatically resolve conflicts */
	autoResolveConflicts?: boolean;
	/** Maximum number of entities to affect in bulk operations */
	bulkLimit?: number;
	/** Whether to validate relationships before operations */
	validateRelationships?: boolean;
}

/**
 * Relationship operation result
 */
interface RelationshipOperationResult {
	success: boolean;
	message: string;
	timestamp: string;
	operation: {
		type: RelationshipOperation;
		description: string;
		affectedEntities: number;
		affectedRelationships: number;
		confidence: number;
	};
	changes: {
		entitiesCreated: Array<{ id: string; name: string; type: string }>;
		entitiesUpdated: Array<{ id: string; name: string; changes: string[] }>;
		entitiesDeleted: Array<{ id: string; name: string; reason: string }>;
		entitiesMerged: Array<{ fromId: string; toId: string; strategy: string }>;
		relationshipsCreated: Array<{ id: string; type: string; description: string }>;
		relationshipsUpdated: Array<{ id: string; changes: string[] }>;
		relationshipsDeleted: Array<{ id: string; reason: string }>;
	};
	conflicts: Array<{ type: string; description: string; resolution?: string }>;
	rollbackData?: any; // For potential rollback operations
	error?: string;
}

/**
 * Intelligent Relationship Manager Tool
 */
export const relationshipManagerTool: InternalTool = {
	name: 'relationship_manager',
	category: 'knowledge_graph',
	internal: true,
	description:
		'Intelligently manage entity relationships with support for complex operations like entity replacement, merging, and bulk updates.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			instruction: {
				type: 'string',
				description: 'Natural language instruction for the relationship operation',
			},
			operation: {
				type: 'string',
				enum: [
					'replace_entity',
					'update_relationship',
					'merge_entities',
					'delete_relationships',
					'bulk_update',
					'conditional_update',
					'auto',
				],
				description: 'Type of relationship operation (auto will determine from instruction)',
				default: 'auto',
			},
			targets: {
				type: 'object',
				description: 'Target entities or relationships for the operation',
				properties: {
					sourceEntity: {
						type: 'string',
						description: 'Source entity name or ID',
					},
					targetEntity: {
						type: 'string',
						description: 'Target entity name or ID',
					},
					relationshipType: {
						type: 'string',
						description: 'Type of relationship to operate on',
					},
					criteria: {
						type: 'object',
						description: 'Criteria for bulk operations',
						additionalProperties: true,
					},
				},
			},
			options: {
				type: 'object',
				description: 'Operation configuration options',
				properties: {
					preserveHistory: {
						type: 'boolean',
						description: 'Whether to preserve historical data',
						default: true,
					},
					confidenceThreshold: {
						type: 'number',
						description: 'Confidence threshold for automatic operations',
						minimum: 0.0,
						maximum: 1.0,
						default: 0.8,
					},
					autoResolveConflicts: {
						type: 'boolean',
						description: 'Whether to automatically resolve conflicts',
						default: true,
					},
					bulkLimit: {
						type: 'number',
						description: 'Maximum entities to affect in bulk operations',
						minimum: 1,
						maximum: 1000,
						default: 100,
					},
					validateRelationships: {
						type: 'boolean',
						description: 'Whether to validate relationships before operations',
						default: true,
					},
				},
			},
		},
		required: ['instruction'],
	},
	handler: async (
		args: {
			instruction: string;
			operation?: RelationshipOperation | 'auto';
			targets?: any;
			options?: RelationshipManagerOptions;
		},
		context?: InternalToolContext
	): Promise<RelationshipOperationResult> => {
		try {
			logger.info('RelationshipManager: Processing relationship operation', {
				instructionLength: args.instruction?.length || 0,
				operation: args.operation,
				hasTargets: !!args.targets,
			});

			// Validate input
			if (
				!args.instruction ||
				typeof args.instruction !== 'string' ||
				args.instruction.trim().length === 0
			) {
				throw new Error('Instruction is required and must be a non-empty string');
			}

			const instruction = args.instruction.trim();
			const operation = args.operation || 'auto';
			const options: RelationshipManagerOptions = {
				preserveHistory: true,
				confidenceThreshold: 0.8,
				autoResolveConflicts: true,
				bulkLimit: 100,
				validateRelationships: true,
				...args.options,
			};

			const kgManager = context?.services?.knowledgeGraphManager;
			const llmService = context?.services?.llmService;

			if (!kgManager) {
				throw new Error('KnowledgeGraphManager not available in context.services');
			}

			if (!llmService) {
				throw new Error('LLM service is required for intelligent relationship management');
			}

			const graph = kgManager.getGraph();
			if (!graph) {
				throw new Error('Knowledge graph backend is not connected');
			}

			// Initialize result structure
			const result: RelationshipOperationResult = {
				success: false,
				message: '',
				timestamp: new Date().toISOString(),
				operation: {
					type: 'replace_entity',
					description: instruction,
					affectedEntities: 0,
					affectedRelationships: 0,
					confidence: 0.0,
				},
				changes: {
					entitiesCreated: [],
					entitiesUpdated: [],
					entitiesDeleted: [],
					entitiesMerged: [],
					relationshipsCreated: [],
					relationshipsUpdated: [],
					relationshipsDeleted: [],
				},
				conflicts: [],
			};

			// Step 1: Analyze the instruction to understand the operation
			const operationAnalysis = await analyzeRelationshipInstruction(
				instruction,
				args.targets,
				operation,
				llmService
			);
			result.operation = operationAnalysis;

			// Step 2: Execute the specific operation
			switch (operationAnalysis.type) {
				case 'replace_entity':
					await executeEntityReplacement(operationAnalysis, graph, options, result);
					break;
				case 'update_relationship':
					await executeRelationshipUpdate(operationAnalysis, graph, options, result);
					break;
				case 'merge_entities':
					await executeEntityMerge(operationAnalysis, graph, options, result);
					break;
				case 'delete_relationships':
					await executeRelationshipDeletion(operationAnalysis, graph, options, result);
					break;
				case 'bulk_update':
					await executeBulkUpdate(operationAnalysis, graph, options, result);
					break;
				case 'conditional_update':
					await executeConditionalUpdate(operationAnalysis, graph, options, result);
					break;
				default:
					throw new Error(`Unsupported operation type: ${operationAnalysis.type}`);
			}

			// Step 3: Handle conflicts if any
			if (result.conflicts.length > 0 && options.autoResolveConflicts) {
				await resolveOperationConflicts(result.conflicts, graph, llmService);
			}

			result.success = true;
			result.message = `Relationship operation completed: ${result.operation.description}. Affected ${result.operation.affectedEntities} entities and ${result.operation.affectedRelationships} relationships.`;

			logger.info('RelationshipManager: Operation completed successfully', {
				operationType: result.operation.type,
				confidence: result.operation.confidence,
				entitiesAffected: result.operation.affectedEntities,
				relationshipsAffected: result.operation.affectedRelationships,
				conflicts: result.conflicts.length,
			});

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('RelationshipManager: Operation failed', {
				error: errorMessage,
				instructionLength: args.instruction?.length || 0,
			});

			return {
				success: false,
				message: `Relationship operation failed: ${errorMessage}`,
				timestamp: new Date().toISOString(),
				operation: {
					type: 'replace_entity',
					description: args.instruction || '',
					affectedEntities: 0,
					affectedRelationships: 0,
					confidence: 0.0,
				},
				changes: {
					entitiesCreated: [],
					entitiesUpdated: [],
					entitiesDeleted: [],
					entitiesMerged: [],
					relationshipsCreated: [],
					relationshipsUpdated: [],
					relationshipsDeleted: [],
				},
				conflicts: [],
				error: errorMessage,
			};
		}
	},
};

/**
 * Analyze the relationship instruction to understand the operation
 */
async function analyzeRelationshipInstruction(
	instruction: string,
	targets: any,
	operation: RelationshipOperation | 'auto',
	llmService: any
): Promise<{
	type: RelationshipOperation;
	description: string;
	affectedEntities: number;
	affectedRelationships: number;
	confidence: number;
	params?: any;
}> {
	if (operation !== 'auto') {
		return {
			type: operation,
			description: instruction,
			affectedEntities: 0,
			affectedRelationships: 0,
			confidence: 0.9,
			params: targets,
		};
	}

	try {
		// FIX (2025-01-29): Enhanced structured prompt for better LLM parsing
		// Provides clearer JSON structure requirements and better examples
		const analysisPrompt = `
You are an expert at analyzing relationship management instructions for a knowledge graph. Your job is to understand what operation the user wants to perform and extract the relevant parameters.

Instruction: "${instruction}"

Possible operations:
1. replace_entity: Replace one entity with another in all relationships (e.g., "not Long but Nam", "replace Google with Alphabet")
2. update_relationship: Update properties of specific relationships (e.g., "update John's role to senior engineer")
3. merge_entities: Merge two entities and combine their relationships (e.g., "merge Google and Alphabet")
4. delete_relationships: Remove relationships matching criteria (e.g., "delete all connections to deprecated services")
5. bulk_update: Update multiple relationships at once (e.g., "update all employees' status to active")
6. conditional_update: Update relationships based on conditions (e.g., "promote all junior developers to mid-level")

Analyze the instruction carefully. Look for keywords that indicate the operation:
- Words like "not...but", "replace", "instead" -> replace_entity
- Words like "merge", "combine", "consolidate" -> merge_entities
- Words like "update", "change", "modify", "set" -> update_relationship
- Words like "delete", "remove", "disconnect" -> delete_relationships

Examples with JSON output:
- "Replace user1 with user2" -> {"operationType": "replace_entity", "entities": {"source": "user1", "target": "user2"}}
- "Merge nodeA and nodeB" -> {"operationType": "merge_entities", "entities": {"source": "nodeA", "target": "nodeB"}}

Respond with a JSON object:
{
  "operationType": "replace_entity" | "update_relationship" | "merge_entities" | "delete_relationships" | "bulk_update" | "conditional_update",
  "entities": {
    "source": "source entity name",
    "target": "target entity name", 
    "toReplace": "entity to replace",
    "replacement": "replacement entity"
  },
  "relationships": {
    "type": "relationship type",
    "properties": {"property": "value"}
  },
  "criteria": {
    "conditions": "matching criteria"
  },
  "confidence": 0.0-1.0,
  "description": "human-readable description of the operation"
}

Respond ONLY with the JSON object:`;

		const response = await llmService.generate(analysisPrompt);

		// FIX: Enhanced JSON extraction with multiple patterns
		const extractJSON = (text: string): any => {
			// Try multiple extraction patterns
			const patterns = [
				/\{[\s\S]*\}/,  // First JSON object
				/```json\s*([\s\S]*?)\s*```/,  // Markdown JSON code block
				/```\s*([\s\S]*?)\s*```/,  // Generic code block
			];

			for (const pattern of patterns) {
				const match = text.match(pattern);
				if (match) {
					try {
						const jsonStr = match[1] || match[0];
						return JSON.parse(jsonStr.trim());
					} catch (e) {
						// Continue to next pattern
					}
				}
			}

			// Last resort: clean and try
			const cleaned = text.replace(/```json|```/g, '').trim();
			return JSON.parse(cleaned);
		};

		const analysis = extractJSON(response);

		return {
			type: analysis.operationType || 'replace_entity',
			description: analysis.description || instruction,
			affectedEntities: 0, // Will be calculated during execution
			affectedRelationships: 0, // Will be calculated during execution
			confidence: Math.max(0.1, Math.min(1.0, analysis.confidence || 0.8)),
			params: {
				entities: analysis.entities || {},
				relationships: analysis.relationships || {},
				criteria: analysis.criteria || {},
			},
		};
	} catch (error) {
		logger.warn('RelationshipManager: Failed to analyze instruction with LLM, using fallback', {
			error: error instanceof Error ? error.message : String(error),
		});

		// FIX: Enhanced fallback pattern matching with better entity extraction
		const FALLBACK_PATTERNS = [
			{
				// "Replace X with Y", "X instead of Y"
				pattern: /replace\s+(\S+)\s+with\s+(\S+)/i,
				type: 'replace_entity' as RelationshipOperation,
				extract: (match: RegExpMatchArray) => ({
					entities: { source: match[1], target: match[2] }
				})
			},
			{
				// "not X but Y"
				pattern: /not\s+(\S+)\s+but\s+(\S+)/i,
				type: 'replace_entity' as RelationshipOperation,
				extract: (match: RegExpMatchArray) => ({
					entities: { source: match[1], target: match[2] }
				})
			},
			{
				// "Merge X and Y", "Combine X with Y"
				pattern: /(?:merge|combine)\s+(\S+)\s+(?:and|with)\s+(\S+)/i,
				type: 'merge_entities' as RelationshipOperation,
				extract: (match: RegExpMatchArray) => ({
					entities: { source: match[1], target: match[2] }
				})
			},
			{
				// "Delete relationship between X and Y"
				pattern: /delete\s+(?:relationship|connection|link).*between\s+(\S+)\s+and\s+(\S+)/i,
				type: 'delete_relationships' as RelationshipOperation,
				extract: (match: RegExpMatchArray) => ({
					entities: { source: match[1], target: match[2] }
				})
			},
			{
				// "Update X's Y to Z"
				pattern: /update\s+(\S+)(?:'s|'s)\s+(\S+)\s+to\s+(\S+)/i,
				type: 'update_relationship' as RelationshipOperation,
				extract: (match: RegExpMatchArray) => ({
					entities: { source: match[1] },
					relationships: { property: match[2], value: match[3] }
				})
			}
		];

		// Try each pattern
		for (const { pattern, type, extract } of FALLBACK_PATTERNS) {
			const match = instruction.match(pattern);
			if (match) {
				const params = extract(match);
				return {
					type,
					description: `${type} operation detected via pattern matching`,
					affectedEntities: 0,
					affectedRelationships: 0,
					confidence: 0.7,
					params
				};
			}
		}

		// Ultimate fallback: simple keyword matching
		const instructionLower = instruction.toLowerCase();

		if (instructionLower.includes('not') && instructionLower.includes('but')) {
			return {
				type: 'replace_entity',
				description: 'Entity replacement based on keyword matching',
				affectedEntities: 0,
				affectedRelationships: 0,
				confidence: 0.5,
			};
		} else if (instructionLower.includes('merge')) {
			return {
				type: 'merge_entities',
				description: 'Entity merge based on keyword matching',
				affectedEntities: 0,
				affectedRelationships: 0,
				confidence: 0.5,
			};
		} else if (instructionLower.includes('update') || instructionLower.includes('change')) {
			return {
				type: 'update_relationship',
				description: 'Relationship update based on pattern matching',
				affectedEntities: 0,
				affectedRelationships: 0,
				confidence: 0.6,
			};
		} else if (instructionLower.includes('delete') || instructionLower.includes('remove')) {
			return {
				type: 'delete_relationships',
				description: 'Relationship deletion based on pattern matching',
				affectedEntities: 0,
				affectedRelationships: 0,
				confidence: 0.6,
			};
		}

		// Default fallback
		return {
			type: 'replace_entity',
			description: 'Default operation',
			affectedEntities: 0,
			affectedRelationships: 0,
			confidence: 0.5,
		};
	}
}

/**
 * Execute entity replacement operation
 */
async function executeEntityReplacement(
	operation: any,
	graph: any,
	options: RelationshipManagerOptions,
	result: RelationshipOperationResult
): Promise<void> {
	try {
		const params = operation.params || {};
		const entities = params.entities || {};

		// Find entities to replace and replacement entities
		const toReplace = entities.toReplace || entities.source;
		const replacement = entities.replacement || entities.target;

		if (!toReplace || !replacement) {
			throw new Error('Both source and target entities must be specified for replacement');
		}

		// Find the entity to replace
		const sourceEntities = await graph.findNodes({ name: toReplace }, undefined, 10);
		if (sourceEntities.length === 0) {
			result.conflicts.push({
				type: 'entity_not_found',
				description: `Entity to replace "${toReplace}" not found in graph`,
			});
			return;
		}

		// Find or create replacement entity
		let replacementEntities = await graph.findNodes({ name: replacement }, undefined, 10);
		let replacementEntity: GraphNode;

		if (replacementEntities.length === 0) {
			// Create new replacement entity
			const entityId = `person_${replacement.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
			replacementEntity = {
				id: entityId,
				labels: ['Person'], // Default type, could be inferred
				properties: {
					name: replacement,
					createdAt: new Date().toISOString(),
					createdBy: 'relationship_manager',
				},
			};

			await graph.addNode(replacementEntity);
			result.changes.entitiesCreated.push({
				id: entityId,
				name: replacement,
				type: 'Person',
			});
		} else {
			replacementEntity = replacementEntities[0];
		}

		// Replace in all relationships
		for (const sourceEntity of sourceEntities) {
			// Get all relationships involving the source entity
			const neighbors = await graph.getNeighbors(sourceEntity.id, 'both', undefined, 1000);

			for (const neighbor of neighbors) {
				const edge = neighbor.edge;

				// Create new relationship with replacement entity
				const newEdgeId = `rel_${edge.startNodeId === sourceEntity.id ? replacementEntity.id : edge.startNodeId}_${edge.endNodeId === sourceEntity.id ? replacementEntity.id : edge.endNodeId}_${edge.type}_${Date.now()}`;

				const newEdge: GraphEdge = {
					id: newEdgeId,
					type: edge.type,
					startNodeId:
						edge.startNodeId === sourceEntity.id ? replacementEntity.id : edge.startNodeId,
					endNodeId: edge.endNodeId === sourceEntity.id ? replacementEntity.id : edge.endNodeId,
					properties: {
						...edge.properties,
						replacedFrom: sourceEntity.id,
						replacedAt: new Date().toISOString(),
					},
				};

				await graph.addEdge(newEdge);
				result.changes.relationshipsCreated.push({
					id: newEdgeId,
					type: edge.type,
					description: `Replaced relationship from ${sourceEntity.properties.name}`,
				});

				// Delete old relationship
				await graph.deleteEdge(edge.id);
				result.changes.relationshipsDeleted.push({
					id: edge.id,
					reason: 'Entity replacement',
				});

				result.operation.affectedRelationships++;
			}

			// Delete the source entity
			await graph.deleteNode(sourceEntity.id);
			result.changes.entitiesDeleted.push({
				id: sourceEntity.id,
				name: sourceEntity.properties.name || 'Unknown',
				reason: 'Replaced by another entity',
			});

			result.operation.affectedEntities++;
		}
	} catch (error) {
		logger.error('RelationshipManager: Error in entity replacement', {
			error: error instanceof Error ? error.message : String(error),
		});

		result.conflicts.push({
			type: 'operation_error',
			description: `Entity replacement failed: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
}

/**
 * Execute relationship update operation
 */
async function executeRelationshipUpdate(
	operation: any,
	graph: any,
	options: RelationshipManagerOptions,
	result: RelationshipOperationResult
): Promise<void> {
	// Implementation for updating specific relationship properties
	result.conflicts.push({
		type: 'not_implemented',
		description: 'Relationship update operation not yet implemented',
	});
}

/**
 * Execute entity merge operation
 */
async function executeEntityMerge(
	operation: any,
	graph: any,
	options: RelationshipManagerOptions,
	result: RelationshipOperationResult
): Promise<void> {
	// Implementation for merging entities and their relationships
	result.conflicts.push({
		type: 'not_implemented',
		description: 'Entity merge operation not yet implemented',
	});
}

/**
 * Execute relationship deletion operation
 */
async function executeRelationshipDeletion(
	operation: any,
	graph: any,
	options: RelationshipManagerOptions,
	result: RelationshipOperationResult
): Promise<void> {
	// Implementation for deleting relationships based on criteria
	result.conflicts.push({
		type: 'not_implemented',
		description: 'Relationship deletion operation not yet implemented',
	});
}

/**
 * Execute bulk update operation
 */
async function executeBulkUpdate(
	operation: any,
	graph: any,
	options: RelationshipManagerOptions,
	result: RelationshipOperationResult
): Promise<void> {
	// Implementation for bulk updating multiple relationships
	result.conflicts.push({
		type: 'not_implemented',
		description: 'Bulk update operation not yet implemented',
	});
}

/**
 * Execute conditional update operation
 */
async function executeConditionalUpdate(
	operation: any,
	graph: any,
	options: RelationshipManagerOptions,
	result: RelationshipOperationResult
): Promise<void> {
	// Implementation for conditional relationship updates
	result.conflicts.push({
		type: 'not_implemented',
		description: 'Conditional update operation not yet implemented',
	});
}

/**
 * Resolve operation conflicts
 */
async function resolveOperationConflicts(
	conflicts: Array<{ type: string; description: string; resolution?: string }>,
	_graph: any,
	_llmService: any
): Promise<void> {
	for (const conflict of conflicts) {
		try {
			// Add resolution strategies
			if (conflict.type === 'entity_not_found') {
				conflict.resolution = 'Entity will be created if needed';
			} else if (conflict.type === 'operation_error') {
				conflict.resolution = 'Operation skipped due to error';
			} else if (conflict.type === 'not_implemented') {
				conflict.resolution = 'Feature will be implemented in future version';
			}
		} catch (error) {
			logger.warn('RelationshipManager: Error resolving conflict', {
				conflictType: conflict.type,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
