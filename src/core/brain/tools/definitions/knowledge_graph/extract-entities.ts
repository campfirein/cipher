/**
 * Extract Entities Tool
 *
 * Extracts entities from text and adds them to the knowledge graph.
 * Uses NLP techniques to identify named entities and relationships.
 */

import { InternalTool, InternalToolContext } from '../../types.js';
import { logger } from '../../../../logger/index.js';

/**
 * Extract entities tool for finding and adding entities from text to knowledge graph
 */
export const extractEntitiesTool: InternalTool = {
	name: 'extract_entities',
	category: 'knowledge_graph',
	internal: true,
	description: 'Extract entities from text and add them to the knowledge graph.',
	version: '1.0.0',
	parameters: {
		type: 'object',
		properties: {
			text: {
				type: 'string',
				description: 'Text to extract entities from',
			},
			options: {
				type: 'object',
				description: 'Extraction options',
				properties: {
					entityTypes: {
						type: 'array',
						items: { type: 'string' },
						description: 'Entity types to focus on (e.g., ["Person", "Organization"])',
					},
					autoLink: {
						type: 'boolean',
						description: 'Whether to automatically create relationships between extracted entities',
						default: true,
					},
					linkTypes: {
						type: 'array',
						items: { type: 'string' },
						description: 'Relationship types to create (e.g., ["IMPLEMENTS", "USES"])',
					},
				},
			},
			// Legacy parameters for backward compatibility
			entityTypes: {
				type: 'array',
				items: { type: 'string' },
				description: 'Optional entity types to focus on (deprecated, use options.entityTypes)',
			},
			autoLink: {
				type: 'boolean',
				description:
					'Whether to automatically create relationships (deprecated, use options.autoLink)',
				default: true,
			},
		},
		required: ['text'],
	},
	handler: async (
		args: {
			text: string;
			options?: {
				entityTypes?: string[];
				autoLink?: boolean;
				linkTypes?: string[];
			};
			// Legacy parameters
			entityTypes?: string[];
			autoLink?: boolean;
		},
		context?: InternalToolContext
	) => {
		try {
			logger.info('ExtractEntities: Processing text for entity extraction', {
				textLength: args.text?.length || 0,
				hasOptions: !!args.options,
			});

			// Validate input
			if (!args.text || typeof args.text !== 'string' || args.text.trim().length === 0) {
				throw new Error('Text is required and must be a non-empty string');
			}

			const text = args.text.trim();

			// Support both new options format and legacy parameters
			const entityTypes = args.options?.entityTypes ||
				args.entityTypes || [
					'Person',
					'Function',
					'Class',
					'Variable',
					'Project',
					'File',
					'Concept',
					'Technology',
					'Command',
					'Tool',
				];
			const autoLink =
				args.options?.autoLink !== undefined
					? args.options.autoLink
					: args.autoLink !== undefined
						? args.autoLink
						: true;
			const linkTypes = args.options?.linkTypes || [
				'IMPLEMENTS',
				'USES',
				'DEPENDS_ON',
				'CALLS',
				'CREATES',
				'MODIFIES',
				'MENTIONS',
				'WORKS_WITH',
			];

			// Extract entities using LLM-based analysis
			const llmService = context?.services?.llmService;
			const extractedEntities = await extractEntitiesFromText(text, entityTypes, llmService);
			const createdRelationships: any[] = [];

			const kgManager = context?.services?.knowledgeGraphManager;
			if (kgManager && extractedEntities.length > 0) {
				const graph = kgManager.getGraph();
				if (graph) {
					// Add entities to graph
					for (const entity of extractedEntities) {
						try {
							await graph.addNode({
								id: entity.id,
								labels: [entity.type],
								properties: {
									name: entity.name,
									confidence: entity.confidence,
									extractedAt: new Date().toISOString(),
									originalText: entity.originalText,
									position: { start: entity.start, end: entity.end },
								},
							});
						} catch (error) {
							logger.debug('ExtractEntities: Failed to add entity node', {
								entityId: entity.id,
								error: error instanceof Error ? error.message : String(error),
							});
						}
					}

					// Create relationships if autoLink is enabled
					if (autoLink && extractedEntities.length > 1) {
						const relationships = await generateEntityRelationships(
							extractedEntities,
							linkTypes,
							text,
							llmService
						);
						for (const rel of relationships) {
							try {
								await graph.addEdge({
									id: rel.id,
									type: rel.type,
									startNodeId: rel.startNodeId,
									endNodeId: rel.endNodeId,
									properties: {
										confidence: rel.confidence,
										extractedAt: new Date().toISOString(),
										basedOnText: rel.context,
									},
								});
								createdRelationships.push(rel);
							} catch (error) {
								logger.debug('ExtractEntities: Failed to add relationship edge', {
									relationshipId: rel.id,
									error: error instanceof Error ? error.message : String(error),
								});
							}
						}
					}
				}
			}

			const extractedCount = extractedEntities.length;
			const linkedCount = createdRelationships.length;

			logger.info('ExtractEntities: Entity extraction completed', {
				extractedCount,
				linkedCount,
				textLength: text.length,
				entityTypes: entityTypes.length,
			});

			return {
				success: true,
				extracted: extractedCount,
				linked: linkedCount,
				entities: extractedEntities,
				relationships: createdRelationships,
				message: 'Entity extraction completed successfully',
				timestamp: new Date().toISOString(),
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('ExtractEntities: Failed to extract entities', {
				error: errorMessage,
				textLength: args.text?.length || 0,
			});

			return {
				success: false,
				error: errorMessage,
				extracted: 0,
				linked: 0,
				timestamp: new Date().toISOString(),
			};
		}
	},
};

/**
 * Extract entities from text using LLM-based analysis
 */
async function extractEntitiesFromText(
	text: string,
	entityTypes: string[],
	llmService?: any
): Promise<
	Array<{
		id: string;
		name: string;
		type: string;
		confidence: number;
		start: number;
		end: number;
		originalText: string;
	}>
> {
	const entities: Array<{
		id: string;
		name: string;
		type: string;
		confidence: number;
		start: number;
		end: number;
		originalText: string;
	}> = [];

	const timestamp = Date.now();

	// Use LLM for entity extraction if available
	if (llmService && text.length > 20) {
		try {
			const entityExtractionPrompt = `
You are an expert entity extraction system. Analyze the following text and extract entities of the specified types.

Entity Types to Extract: ${entityTypes.join(', ')}

Text to Analyze:
"""
${text}
"""

For each entity found, respond with a JSON array containing objects with these fields:
- name: The entity name/identifier
- type: One of the specified entity types
- confidence: Confidence score from 0.0 to 1.0
- context: A brief phrase showing the entity in context
- description: Brief description of what this entity represents

Focus on meaningful entities that represent important concepts, objects, or relationships in the text. Avoid extracting overly generic terms.

Respond ONLY with the JSON array, no other text:`;

			const response = await llmService.generate(entityExtractionPrompt);

			// Parse LLM response
			try {
				const cleanResponse = response.replace(/```json|```/g, '').trim();
				const llmEntities = JSON.parse(cleanResponse);

				if (Array.isArray(llmEntities)) {
					llmEntities.forEach((entity: any, index: number) => {
						if (entity.name && entity.type && entityTypes.includes(entity.type)) {
							// Try to find the entity in the original text to get position
							const entityName = String(entity.name);
							const searchIndex = text.toLowerCase().indexOf(entityName.toLowerCase());

							entities.push({
								id: `${entity.type.toLowerCase()}_${entityName.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}_${index}`,
								name: entityName,
								type: entity.type,
								confidence: Math.max(0.1, Math.min(1.0, Number(entity.confidence) || 0.8)),
								start: searchIndex >= 0 ? searchIndex : 0,
								end: searchIndex >= 0 ? searchIndex + entityName.length : entityName.length,
								originalText: entity.context || entityName,
							});
						}
					});
				}
			} catch (parseError) {
				logger.debug(
					'ExtractEntities: Failed to parse LLM response, falling back to regex patterns',
					{
						parseError: parseError instanceof Error ? parseError.message : String(parseError),
						response: response.substring(0, 200),
					}
				);
			}
		} catch (llmError) {
			logger.debug('ExtractEntities: LLM extraction failed, falling back to regex patterns', {
				llmError: llmError instanceof Error ? llmError.message : String(llmError),
			});
		}
	}

	// If LLM extraction didn't produce results, fall back to regex patterns
	if (entities.length === 0) {
		await extractEntitiesWithRegex(text, entityTypes, entities, timestamp);
	}

	// Remove duplicates by name and type
	const uniqueEntities = entities.filter(
		(entity, index, self) =>
			index === self.findIndex(e => e.name === entity.name && e.type === entity.type)
	);

	return uniqueEntities;
}

/**
 * Fallback regex-based entity extraction
 */
async function extractEntitiesWithRegex(
	text: string,
	entityTypes: string[],
	entities: Array<{
		id: string;
		name: string;
		type: string;
		confidence: number;
		start: number;
		end: number;
		originalText: string;
	}>,
	timestamp: number
): Promise<void> {
	// Function/Method extraction
	if (entityTypes.includes('Function')) {
		const functionPatterns = [
			/(?:function|def|fn)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
			/(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?\(/g,
			/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([^)]*\)\s*\{/g,
		];

		functionPatterns.forEach(pattern => {
			let match;
			while ((match = pattern.exec(text)) !== null) {
				const name = match[1];
				if (name && typeof name === 'string' && name.length > 1) {
					entities.push({
						id: `function_${name}_${timestamp}_${entities.length}`,
						name,
						type: 'Function',
						confidence: 0.85,
						start: match.index,
						end: match.index + match[0].length,
						originalText: match[0],
					});
				}
			}
		});
	}

	// Class extraction
	if (entityTypes.includes('Class')) {
		const classPattern = /class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
		let match;
		while ((match = classPattern.exec(text)) !== null) {
			const name = match[1];
			if (name && typeof name === 'string') {
				entities.push({
					id: `class_${name}_${timestamp}_${entities.length}`,
					name,
					type: 'Class',
					confidence: 0.9,
					start: match.index,
					end: match.index + match[0].length,
					originalText: match[0],
				});
			}
		}
	}

	// File path extraction
	if (entityTypes.includes('File')) {
		const filePattern =
			/['"`]([^'"`]*\.(?:js|ts|py|java|cpp|c|h|json|md|txt|yml|yaml|xml|css|scss|html))['"]/gi;
		let match;
		while ((match = filePattern.exec(text)) !== null) {
			const path = match[1];
			if (path && typeof path === 'string') {
				entities.push({
					id: `file_${path.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}_${entities.length}`,
					name: path,
					type: 'File',
					confidence: 0.95,
					start: match.index,
					end: match.index + match[0].length,
					originalText: match[0],
				});
			}
		}
	}

	// Technology/Tool extraction
	if (entityTypes.includes('Technology') || entityTypes.includes('Tool')) {
		const techKeywords = [
			'React',
			'Vue',
			'Angular',
			'Node.js',
			'Python',
			'TypeScript',
			'JavaScript',
			'Java',
			'C++',
			'Docker',
			'Kubernetes',
			'Git',
			'npm',
			'yarn',
			'webpack',
			'babel',
			'MongoDB',
			'PostgreSQL',
			'Redis',
			'AWS',
			'Azure',
			'GCP',
		];

		// FIX (2025-01-29): Added helper function to escape regex special characters
		// This fixes the "Invalid regular expression: /\bC++\b/: Nothing to repeat" error
		// The + characters in C++ are regex quantifiers that need to be escaped
		const escapeRegex = (str: string): string => {
			return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		};

		techKeywords.forEach(tech => {
			// FIX: Escape special regex characters in technology names (e.g., C++)
			// This allows proper matching of technologies like C++, .NET, etc.
			const escapedTech = escapeRegex(tech);
			const regex = new RegExp(`\\b${escapedTech}\\b`, 'gi');
			let match;
			while ((match = regex.exec(text)) !== null) {
				entities.push({
					id: `tech_${tech}_${timestamp}_${entities.length}`,
					name: tech,
					type: 'Technology',
					confidence: 0.8,
					start: match.index,
					end: match.index + match[0].length,
					originalText: match[0],
				});
			}
		});
	}

	// Variable extraction
	if (entityTypes.includes('Variable')) {
		const varPattern = /(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
		let match;
		while ((match = varPattern.exec(text)) !== null) {
			const name = match[1];
			if (
				name &&
				typeof name === 'string' &&
				name.length > 1 &&
				!['const', 'let', 'var'].includes(name)
			) {
				entities.push({
					id: `var_${name}_${timestamp}_${entities.length}`,
					name,
					type: 'Variable',
					confidence: 0.7,
					start: match.index,
					end: match.index + match[0].length,
					originalText: match[0],
				});
			}
		}
	}
}

/**
 * Generate relationships between extracted entities using LLM analysis
 */
async function generateEntityRelationships(
	entities: Array<{ id: string; name: string; type: string; start: number; end: number }>,
	linkTypes: string[],
	text: string,
	llmService?: any
): Promise<
	Array<{
		id: string;
		type: string;
		startNodeId: string;
		endNodeId: string;
		confidence: number;
		context: string;
	}>
> {
	const relationships: Array<{
		id: string;
		type: string;
		startNodeId: string;
		endNodeId: string;
		confidence: number;
		context: string;
	}> = [];

	// Use LLM for relationship analysis if available and we have multiple entities
	if (llmService && entities.length > 1 && text.length > 50) {
		try {
			const entityList = entities.map(e => `- ${e.name} (${e.type})`).join('\n');
			const relationshipPrompt = `
You are an expert relationship analyzer. Given the following entities extracted from text, identify meaningful relationships between them.

Entities:
${entityList}

Available Relationship Types: ${linkTypes.join(', ')}

Original Text Context:
"""
${text}
"""

For each meaningful relationship you identify, respond with a JSON array containing objects with these fields:
- sourceEntity: Name of the source entity
- targetEntity: Name of the target entity
- relationshipType: One of the available relationship types that best describes the connection
- confidence: Confidence score from 0.0 to 1.0
- reasoning: Brief explanation of why this relationship exists

Focus on relationships that are clearly evident from the text context. Avoid speculative connections.

Respond ONLY with the JSON array, no other text:`;

			const response = await llmService.generate(relationshipPrompt);

			// Parse LLM response
			try {
				const cleanResponse = response.replace(/```json|```/g, '').trim();
				const llmRelationships = JSON.parse(cleanResponse);

				if (Array.isArray(llmRelationships)) {
					llmRelationships.forEach((rel: any) => {
						if (rel.sourceEntity && rel.targetEntity && rel.relationshipType) {
							// Find the corresponding entities
							const sourceEntity = entities.find(e => e.name === rel.sourceEntity);
							const targetEntity = entities.find(e => e.name === rel.targetEntity);

							if (sourceEntity && targetEntity && linkTypes.includes(rel.relationshipType)) {
								// Calculate context around both entities
								const contextStart = Math.max(
									0,
									Math.min(sourceEntity.start, targetEntity.start) - 50
								);
								const contextEnd = Math.min(
									text.length,
									Math.max(sourceEntity.end, targetEntity.end) + 50
								);
								const context = text.substring(contextStart, contextEnd);

								relationships.push({
									id: `rel_${sourceEntity.id}_${targetEntity.id}_${Date.now()}_${relationships.length}`,
									type: rel.relationshipType,
									startNodeId: sourceEntity.id,
									endNodeId: targetEntity.id,
									confidence: Math.max(0.1, Math.min(1.0, Number(rel.confidence) || 0.7)),
									context: context,
								});
							}
						}
					});
				}
			} catch (parseError) {
				logger.debug(
					'ExtractEntities: Failed to parse LLM relationship response, falling back to rule-based approach',
					{
						parseError: parseError instanceof Error ? parseError.message : String(parseError),
						response: response.substring(0, 200),
					}
				);
			}
		} catch (llmError) {
			logger.debug(
				'ExtractEntities: LLM relationship analysis failed, falling back to rule-based approach',
				{
					llmError: llmError instanceof Error ? llmError.message : String(llmError),
				}
			);
		}
	}

	// If LLM analysis didn't produce results, fall back to rule-based approach
	if (relationships.length === 0) {
		for (let i = 0; i < entities.length; i++) {
			for (let j = i + 1; j < entities.length; j++) {
				const entity1 = entities[i];
				const entity2 = entities[j];

				// Skip if either entity is undefined
				if (!entity1 || !entity2) continue;

				// Determine relationship type based on entity types and proximity
				const relType = determineRelationshipType(entity1, entity2, linkTypes);
				if (!relType) continue;

				// Calculate confidence based on proximity and context
				const distance = Math.abs(entity1.start - entity2.start);
				const maxDistance = 500; // characters
				const proximityScore = Math.max(0, 1 - distance / maxDistance);
				const confidence = Math.min(0.9, 0.3 + proximityScore * 0.6);

				// Extract context around the entities
				const contextStart = Math.max(0, Math.min(entity1.start, entity2.start) - 50);
				const contextEnd = Math.min(text.length, Math.max(entity1.end, entity2.end) + 50);
				const context = text.substring(contextStart, contextEnd);

				relationships.push({
					id: `rel_${entity1.id}_${entity2.id}_${Date.now()}`,
					type: relType,
					startNodeId: entity1.id,
					endNodeId: entity2.id,
					confidence,
					context,
				});
			}
		}
	}

	return relationships;
}

/**
 * Determine relationship type between two entities
 */
function determineRelationshipType(
	entity1: { type: string },
	entity2: { type: string },
	linkTypes: string[]
): string | null {
	const type1 = entity1.type;
	const type2 = entity2.type;

	// Function to Class relationships
	if ((type1 === 'Function' && type2 === 'Class') || (type1 === 'Class' && type2 === 'Function')) {
		return linkTypes.includes('BELONGS_TO') ? 'BELONGS_TO' : 'MENTIONS';
	}

	// File to Code relationships
	if (
		(type1 === 'File' && ['Function', 'Class', 'Variable'].includes(type2)) ||
		(['Function', 'Class', 'Variable'].includes(type1) && type2 === 'File')
	) {
		return linkTypes.includes('CONTAINS') ? 'CONTAINS' : 'MENTIONS';
	}

	// Technology relationships
	if (
		(type1 === 'Technology' && ['Function', 'Class', 'Project'].includes(type2)) ||
		(['Function', 'Class', 'Project'].includes(type1) && type2 === 'Technology')
	) {
		return linkTypes.includes('USES') ? 'USES' : 'MENTIONS';
	}

	// Function to Function relationships
	if (type1 === 'Function' && type2 === 'Function') {
		return linkTypes.includes('CALLS') ? 'CALLS' : 'MENTIONS';
	}

	// Default relationship
	return linkTypes.includes('MENTIONS') ? 'MENTIONS' : linkTypes[0] || 'RELATED_TO';
}
