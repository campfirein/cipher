/**
 * Link Generator
 *
 * Implements systematic link generation process from A-MEM paper.
 * Retrieves Top-k most relevant historical memories and uses LLM to determine
 * whether connections should be established between them.
 */

import type { ILLMService } from '../brain/llm/services/types.js';
import type { VectorStore } from '../vector_storage/backend/vector-store.js';
import type { MemoryNote as IMemoryNote, MemoryRelationship, MemoryEvolution } from './types.js';
import { MemoryNote } from './memory-note.js';
import { MemoryBoxManager } from './memory-box.js';
import {
	LOG_PREFIXES,
	SYSTEM_PROMPTS,
	EVOLUTION_TYPES,
	SEARCH_CONFIG,
	PERFORMANCE_CONFIG,
} from './constants.js';
import { createLogger } from '../logger/index.js';
import { env } from '../env.js';

/**
 * Link generation decision from LLM
 */
interface LinkGenerationDecision {
	shouldCreateLinks: boolean;
	suggestedLinks: {
		sourceId: string;
		targetId: string;
		relationshipType: 'semantic' | 'temporal' | 'categorical' | 'explicit';
		strength: number;
		reasoning: string;
	}[];
	reasoning: string;
}

/**
 * Manages systematic link generation following A-MEM methodology
 */
export class LinkGenerator {
	private readonly logger = createLogger({ level: env.CIPHER_LOG_LEVEL });

	constructor(
		private readonly llmService: ILLMService,
		private readonly vectorStore: VectorStore,
		private readonly embeddingService: any,
		private readonly boxManager: MemoryBoxManager,
		private readonly maxRelatedMemories: number = 5
	) {}

	/**
	 * Generate links for a new memory following A-MEM workflow
	 */
	async generateLinks(
		newMemory: MemoryNote,
		existingMemories: Map<string, MemoryNote>
	): Promise<{
		generatedLinks: MemoryRelationship[];
		updatedMemories: MemoryNote[];
		boxAssignment: string;
	}> {
		this.logger.debug(`${LOG_PREFIXES.MEMORY_SYSTEM} Starting A-MEM link generation`, {
			memoryId: newMemory.id,
			existingMemoriesCount: existingMemories.size,
		});

		try {
			// Step 1: Retrieve Top-k most relevant historical memories
			const relatedMemories = await this.findTopKRelatedMemories(newMemory, existingMemories);

			if (relatedMemories.length === 0) {
				this.logger.debug(
					`${LOG_PREFIXES.MEMORY_SYSTEM} No related memories found for link generation`,
					{
						memoryId: newMemory.id,
					}
				);

				// Organize into box even without links
				const boxResult = await this.boxManager.organizeMemory(newMemory, existingMemories);

				return {
					generatedLinks: [],
					updatedMemories: [],
					boxAssignment: boxResult.boxId,
				};
			}

			// Step 2: Use LLM to determine connections (A-MEM Link Generation step)
			const linkDecision = await this.getLinkGenerationDecision(newMemory, relatedMemories);

			// Step 3: Create relationships and update memories
			const { relationships, updatedMemories } = await this.createMemoryRelationships(
				newMemory,
				relatedMemories,
				linkDecision,
				existingMemories
			);

			// Step 4: Organize into memory boxes (A-MEM box concept)
			const boxResult = await this.boxManager.organizeMemory(newMemory, existingMemories);

			this.logger.info(`${LOG_PREFIXES.MEMORY_SYSTEM} A-MEM link generation completed`, {
				memoryId: newMemory.id,
				linksGenerated: relationships.length,
				memoriesUpdated: updatedMemories.length,
				boxId: boxResult.boxId,
				isNewBox: boxResult.isNewBox,
			});

			return {
				generatedLinks: relationships,
				updatedMemories,
				boxAssignment: boxResult.boxId,
			};
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MEMORY_SYSTEM} Link generation failed`, {
				memoryId: newMemory.id,
				error: error instanceof Error ? error.message : String(error),
			});

			// Fallback: organize into box without links
			const boxResult = await this.boxManager.organizeMemory(newMemory, existingMemories);

			return {
				generatedLinks: [],
				updatedMemories: [],
				boxAssignment: boxResult.boxId,
			};
		}
	}

	/**
	 * Find Top-k most relevant historical memories using vector similarity
	 */
	private async findTopKRelatedMemories(
		memory: MemoryNote,
		existingMemories: Map<string, MemoryNote>
	): Promise<MemoryNote[]> {
		try {
			// Get embedding for the memory content
			const embedding = await this.embeddingService.embed(memory.content);

			// Search for similar memories using vector store
			const searchResults = await this.vectorStore.search(embedding, this.maxRelatedMemories);

			// Convert search results to memory notes, excluding the new memory itself
			const relatedMemories: MemoryNote[] = [];
			for (const result of searchResults) {
				const memoryId = String(result.id);
				if (memoryId && memoryId !== memory.id && existingMemories.has(memoryId)) {
					const existingMemory = existingMemories.get(memoryId);
					if (existingMemory) {
						relatedMemories.push(existingMemory);
					}
				}
			}

			this.logger.debug(
				`${LOG_PREFIXES.MEMORY_SYSTEM} Found related memories for link generation`,
				{
					memoryId: memory.id,
					relatedCount: relatedMemories.length,
				}
			);

			return relatedMemories;
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MEMORY_SYSTEM} Failed to find related memories`, {
				memoryId: memory.id,
				error: error instanceof Error ? error.message : String(error),
			});
			return [];
		}
	}

	/**
	 * Get link generation decision from LLM
	 */
	private async getLinkGenerationDecision(
		newMemory: MemoryNote,
		relatedMemories: MemoryNote[]
	): Promise<LinkGenerationDecision> {
		// Format related memories for LLM analysis
		const memoriesText = relatedMemories
			.map((memory, index) => {
				return `Memory ${index + 1}:
ID: ${memory.id}
Content: ${memory.content}
Context: ${memory.context}
Keywords: ${JSON.stringify(memory.keywords)}
Tags: ${JSON.stringify(memory.tags)}
Timestamp: ${memory.timestamp}`;
			})
			.join('\n\n');

		const prompt = `You are an AI memory connection analyst following the A-MEM (Agentic Memory) methodology.

Analyze the NEW MEMORY and RELATED MEMORIES to determine if connections should be established.

NEW MEMORY:
Content: ${newMemory.content}
Context: ${newMemory.context}
Keywords: ${JSON.stringify(newMemory.keywords)}
Tags: ${JSON.stringify(newMemory.tags)}
Timestamp: ${newMemory.timestamp}

RELATED MEMORIES:
${memoriesText}

Based on the A-MEM methodology, determine:
1. Should connections be created between the new memory and any of the related memories?
2. What type of relationships exist (semantic, temporal, categorical, explicit)?
3. What is the strength of each relationship (0.0 to 1.0)?

Respond with JSON in the following format:
{
	"shouldCreateLinks": true/false,
	"suggestedLinks": [
		{
			"sourceId": "new_memory_id",
			"targetId": "related_memory_id",
			"relationshipType": "semantic|temporal|categorical|explicit",
			"strength": 0.0-1.0,
			"reasoning": "brief explanation"
		}
	],
	"reasoning": "overall reasoning for the decisions"
}`;

		try {
			const systemPrompt = 'You are a memory connection analyst. Respond with valid JSON only.';
			const response = await this.llmService.directGenerate(prompt, systemPrompt);
			const decision = this.parseLinkDecision(response);

			this.logger.debug(`${LOG_PREFIXES.MEMORY_SYSTEM} Got link generation decision`, {
				memoryId: newMemory.id,
				shouldCreateLinks: decision.shouldCreateLinks,
				suggestedLinksCount: decision.suggestedLinks.length,
			});

			return decision;
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MEMORY_SYSTEM} Failed to get link generation decision`, {
				memoryId: newMemory.id,
				error: error instanceof Error ? error.message : String(error),
			});

			// Return default decision (no links)
			return {
				shouldCreateLinks: false,
				suggestedLinks: [],
				reasoning: 'LLM analysis failed, no links generated',
			};
		}
	}

	/**
	 * Parse link generation decision from LLM response
	 */
	private parseLinkDecision(response: string): LinkGenerationDecision {
		try {
			const parsed = JSON.parse(response);

			return {
				shouldCreateLinks: Boolean(parsed.shouldCreateLinks),
				suggestedLinks: Array.isArray(parsed.suggestedLinks)
					? parsed.suggestedLinks.map((link: any) => ({
							sourceId: String(link.sourceId || ''),
							targetId: String(link.targetId || ''),
							relationshipType: link.relationshipType || 'semantic',
							strength: Math.max(0, Math.min(1, Number(link.strength) || 0.5)),
							reasoning: String(link.reasoning || ''),
						}))
					: [],
				reasoning: String(parsed.reasoning || ''),
			};
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MEMORY_SYSTEM} Failed to parse link decision`, {
				response,
				error: error instanceof Error ? error.message : String(error),
			});

			return {
				shouldCreateLinks: false,
				suggestedLinks: [],
				reasoning: 'Failed to parse LLM response',
			};
		}
	}

	/**
	 * Create memory relationships and update memories accordingly
	 */
	private async createMemoryRelationships(
		newMemory: MemoryNote,
		relatedMemories: MemoryNote[],
		decision: LinkGenerationDecision,
		existingMemories: Map<string, MemoryNote>
	): Promise<{
		relationships: MemoryRelationship[];
		updatedMemories: MemoryNote[];
	}> {
		const relationships: MemoryRelationship[] = [];
		const updatedMemories: MemoryNote[] = [];
		const evolutionTimestamp = new Date().toISOString();

		if (!decision.shouldCreateLinks || decision.suggestedLinks.length === 0) {
			return { relationships, updatedMemories };
		}

		// Create relationships based on LLM decisions
		for (const linkSuggestion of decision.suggestedLinks) {
			const targetMemory = existingMemories.get(linkSuggestion.targetId);
			if (!targetMemory) continue;

			// Create relationship object
			const relationship: MemoryRelationship = {
				sourceId: newMemory.id,
				targetId: linkSuggestion.targetId,
				strength: linkSuggestion.strength,
				type: linkSuggestion.relationshipType,
				createdAt: evolutionTimestamp,
				metadata: {
					reasoning: linkSuggestion.reasoning,
					generatedBy: 'A-MEM Link Generator',
				},
			};
			relationships.push(relationship);

			// Update new memory with links
			newMemory.addLink(linkSuggestion.targetId);

			// Update target memory with bidirectional link
			const updatedTargetMemory = MemoryNote.fromObject(targetMemory);
			updatedTargetMemory.addLink(newMemory.id);

			// Record evolution in target memory
			const evolution: MemoryEvolution = {
				timestamp: evolutionTimestamp,
				type: EVOLUTION_TYPES.LINK_CREATION,
				description: `New link created to memory ${newMemory.id} via A-MEM link generation`,
				involvedMemories: [newMemory.id],
				changes: {
					addedLinks: [newMemory.id],
				},
			};
			updatedTargetMemory.addEvolution(evolution);

			updatedMemories.push(updatedTargetMemory);
		}

		// Record evolution in new memory if links were created
		if (relationships.length > 0) {
			const newMemoryEvolution: MemoryEvolution = {
				timestamp: evolutionTimestamp,
				type: EVOLUTION_TYPES.LINK_CREATION,
				description: `Links created to ${relationships.length} memories via A-MEM link generation`,
				involvedMemories: relationships.map(r => r.targetId),
				changes: {
					addedLinks: relationships.map(r => r.targetId),
				},
			};
			newMemory.addEvolution(newMemoryEvolution);
		}

		return { relationships, updatedMemories };
	}

	/**
	 * Analyze existing memories to suggest new connections
	 */
	async analyzeExistingConnections(memories: Map<string, MemoryNote>): Promise<{
		suggestedConnections: MemoryRelationship[];
		analysis: string;
	}> {
		const memoriesArray = Array.from(memories.values());
		const suggestedConnections: MemoryRelationship[] = [];

		// Analyze memories in batches to avoid overwhelming the LLM
		const batchSize = Math.min(PERFORMANCE_CONFIG.BATCH_SIZE, 10);

		for (let i = 0; i < memoriesArray.length; i += batchSize) {
			const batch = memoriesArray.slice(i, i + batchSize);

			for (let j = 0; j < batch.length; j++) {
				for (let k = j + 1; k < batch.length; k++) {
					const memory1 = batch[j];
					const memory2 = batch[k];

					// Skip if memories don't exist or already connected
					if (
						!memory1 ||
						!memory2 ||
						memory1.isLinkedTo(memory2.id) ||
						memory2.isLinkedTo(memory1.id)
					) {
						continue;
					}

					// Check potential connection
					const similarity = this.calculateMemorySimilarity(memory1, memory2);
					if (similarity > 0.7) {
						// High similarity threshold
						const relationship: MemoryRelationship = {
							sourceId: memory1.id,
							targetId: memory2.id,
							strength: similarity,
							type: 'semantic',
							createdAt: new Date().toISOString(),
							metadata: {
								reasoning: 'High semantic similarity detected',
								generatedBy: 'A-MEM Connection Analyzer',
							},
						};
						suggestedConnections.push(relationship);
					}
				}
			}
		}

		return {
			suggestedConnections,
			analysis: `Analyzed ${memoriesArray.length} memories and found ${suggestedConnections.length} potential connections`,
		};
	}

	/**
	 * Calculate similarity between two memories
	 */
	private calculateMemorySimilarity(memory1: MemoryNote, memory2: MemoryNote): number {
		let score = 0;
		let factors = 0;

		// Context similarity
		if (memory1.context === memory2.context) {
			score += 0.3;
		}
		factors++;

		// Tag overlap
		const tagOverlap = memory1.tags.filter(tag => memory2.tags.includes(tag)).length;
		const tagScore = tagOverlap / Math.max(memory1.tags.length, memory2.tags.length, 1);
		score += tagScore * 0.4;
		factors++;

		// Keyword overlap
		const keywordOverlap = memory1.keywords.filter(keyword =>
			memory2.keywords.some(
				k2 =>
					keyword.toLowerCase().includes(k2.toLowerCase()) ||
					k2.toLowerCase().includes(keyword.toLowerCase())
			)
		).length;
		const keywordScore =
			keywordOverlap / Math.max(memory1.keywords.length, memory2.keywords.length, 1);
		score += keywordScore * 0.3;
		factors++;

		return score / factors;
	}
}
