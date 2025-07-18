/**
 * Evolution Engine
 *
 * Handles memory evolution and relationship building in the agentic memory system
 */

import type { ILLMService } from '../brain/llm/services/types.js';
import type { VectorStore } from '../vector_storage/backend/vector-store.js';
import type { MemoryEvolution, MemoryEvolutionDecision, MemorySearchResult } from './types.js';
import { MemoryEvolutionError } from './types.js';
import { MemoryNote } from './memory-note.js';
import {
	SYSTEM_PROMPTS,
	ERROR_MESSAGES,
	LOG_PREFIXES,
	EVOLUTION_TYPES,
	EVOLUTION_CONFIG,
	METADATA_KEYS,
} from './constants.js';
import { getPerformanceConfig } from './config.js';
import { createLogger } from '../logger/index.js';
import { env } from '../env.js';

/**
 * Evolution engine for managing memory evolution and relationships
 */
export class EvolutionEngine {
	private readonly logger = createLogger({ level: env.CIPHER_LOG_LEVEL });
	private readonly performanceConfig = getPerformanceConfig();

	constructor(
		private readonly llmService: ILLMService,
		private readonly vectorStore: VectorStore,
		private readonly collectionName: string,
		private readonly maxRelatedMemories: number = 5,
		private readonly embeddingService?: any
	) {}

	/**
	 * Process a memory note and determine if it should evolve
	 */
	async processMemory(
		memory: MemoryNote,
		existingMemories: Map<string, MemoryNote>
	): Promise<{ shouldEvolve: boolean; updatedMemory: MemoryNote; updatedNeighbors: MemoryNote[] }> {
		this.logger.debug(`${LOG_PREFIXES.EVOLUTION_ENGINE} Processing memory for evolution`, {
			memoryId: memory.id,
			existingMemoriesCount: existingMemories.size,
		});

		try {
			// If no existing memories, no evolution needed
			if (existingMemories.size === 0) {
				return { shouldEvolve: false, updatedMemory: memory, updatedNeighbors: [] };
			}

			// Find related memories
			const relatedMemories = await this.findRelatedMemories(memory, existingMemories);

			if (relatedMemories.length < EVOLUTION_CONFIG.MIN_RELATED_MEMORIES) {
				this.logger.debug(
					`${LOG_PREFIXES.EVOLUTION_ENGINE} Not enough related memories for evolution`,
					{
						memoryId: memory.id,
						relatedCount: relatedMemories.length,
						required: EVOLUTION_CONFIG.MIN_RELATED_MEMORIES,
					}
				);
				return { shouldEvolve: false, updatedMemory: memory, updatedNeighbors: [] };
			}

			// Get evolution decision from LLM
			const decision = await this.getEvolutionDecision(memory, relatedMemories);

			if (!decision.shouldEvolve) {
				this.logger.debug(`${LOG_PREFIXES.EVOLUTION_ENGINE} LLM decided not to evolve memory`, {
					memoryId: memory.id,
				});
				return { shouldEvolve: false, updatedMemory: memory, updatedNeighbors: [] };
			}

			// Apply evolution
			const { updatedMemory, updatedNeighbors } = await this.applyEvolution(
				memory,
				relatedMemories,
				decision,
				existingMemories
			);

			this.logger.info(`${LOG_PREFIXES.EVOLUTION_ENGINE} Memory evolution completed`, {
				memoryId: memory.id,
				actions: decision.actions,
				updatedNeighborsCount: updatedNeighbors.length,
			});

			return { shouldEvolve: true, updatedMemory, updatedNeighbors };
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.EVOLUTION_ENGINE} Memory evolution failed`, {
				memoryId: memory.id,
				error: error instanceof Error ? error.message : String(error),
			});

			throw new MemoryEvolutionError(ERROR_MESSAGES.EVOLUTION_FAILED, memory.id, error);
		}
	}

	/**
	 * Find related memories using vector similarity search
	 */
	private async findRelatedMemories(
		memory: MemoryNote,
		existingMemories: Map<string, MemoryNote>
	): Promise<MemoryNote[]> {
		try {
			// Get embedding for the memory content first
			const embedding = await this.getEmbedding(memory.content);
			// Search for similar memories using vector store
			const searchResults = await this.vectorStore.search(embedding, this.maxRelatedMemories);

			// Convert search results to memory notes
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

			this.logger.debug(`${LOG_PREFIXES.EVOLUTION_ENGINE} Found related memories`, {
				memoryId: memory.id,
				relatedCount: relatedMemories.length,
			});

			return relatedMemories;
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.EVOLUTION_ENGINE} Failed to find related memories`, {
				memoryId: memory.id,
				error: error instanceof Error ? error.message : String(error),
			});
			return [];
		}
	}

	/**
	 * Get evolution decision from LLM
	 */
	private async getEvolutionDecision(
		memory: MemoryNote,
		relatedMemories: MemoryNote[]
	): Promise<MemoryEvolutionDecision> {
		// Format related memories for LLM
		const neighborsText = relatedMemories
			.map((m, index) => {
				return `memory index:${index}\ttalk start time:${m.timestamp}\tmemory content: ${m.content}\tmemory context: ${m.context}\tmemory keywords: ${JSON.stringify(m.keywords)}\tmemory tags: ${JSON.stringify(m.tags)}`;
			})
			.join('\n');

		const prompt = SYSTEM_PROMPTS.MEMORY_EVOLUTION.replace('{context}', memory.context)
			.replace('{content}', memory.content)
			.replace('{keywords}', JSON.stringify(memory.keywords))
			.replace('{nearest_neighbors_memories}', neighborsText)
			.replace('{neighbor_number}', relatedMemories.length.toString());

		try {
			// Use structured JSON format for better parsing reliability
			const systemPrompt =
				'You are a memory evolution agent. Respond with valid JSON matching the exact schema provided.';
			const response = await this.llmService.directGenerate(prompt, systemPrompt);
			const decision = this.parseEvolutionDecision(response);

			this.logger.debug(`${LOG_PREFIXES.EVOLUTION_ENGINE} Got evolution decision`, {
				memoryId: memory.id,
				shouldEvolve: decision.shouldEvolve,
				actions: decision.actions,
				suggestedConnections: decision.suggestedConnections.length,
			});

			return decision;
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.EVOLUTION_ENGINE} Failed to get evolution decision`, {
				memoryId: memory.id,
				error: error instanceof Error ? error.message : String(error),
			});

			// Return default decision (no evolution)
			return {
				shouldEvolve: false,
				actions: [],
				suggestedConnections: [],
				tagsToUpdate: [],
				newContextNeighborhood: [],
				newTagsNeighborhood: [],
			};
		}
	}

	/**
	 * Apply evolution changes to memory and neighbors
	 */
	private async applyEvolution(
		memory: MemoryNote,
		relatedMemories: MemoryNote[],
		decision: MemoryEvolutionDecision,
		existingMemories: Map<string, MemoryNote>
	): Promise<{ updatedMemory: MemoryNote; updatedNeighbors: MemoryNote[] }> {
		const updatedMemory = MemoryNote.fromObject(memory);
		const updatedNeighbors: MemoryNote[] = [];
		const evolutionTimestamp = new Date().toISOString();

		// Apply evolution actions
		for (const action of decision.actions) {
			if (action === 'strengthen') {
				// Strengthen connections
				for (const connectionId of decision.suggestedConnections) {
					if (existingMemories.has(connectionId)) {
						updatedMemory.addLink(connectionId);
					}
				}

				// Update tags
				if (decision.tagsToUpdate.length > 0) {
					updatedMemory.updateTags(decision.tagsToUpdate);
				}

				// Record evolution
				const evolution: MemoryEvolution = {
					timestamp: evolutionTimestamp,
					type: EVOLUTION_TYPES.STRENGTHEN,
					description: `Strengthened connections to ${decision.suggestedConnections.length} memories`,
					involvedMemories: decision.suggestedConnections,
					changes: {
						addedLinks: decision.suggestedConnections,
						updatedTags: decision.tagsToUpdate,
					},
				};
				updatedMemory.addEvolution(evolution);
			} else if (action === 'update_neighbor') {
				// Update neighbor memories following A-MEM paper methodology
				const maxNeighbors = Math.min(
					relatedMemories.length,
					decision.newContextNeighborhood.length,
					decision.newTagsNeighborhood.length
				);

				for (let i = 0; i < maxNeighbors; i++) {
					const relatedMemory = relatedMemories[i];
					if (!relatedMemory) continue;

					const updatedNeighbor = MemoryNote.fromObject(relatedMemory);
					let hasChanges = false;

					// Update context if provided and different
					if (i < decision.newContextNeighborhood.length) {
						const newContext = decision.newContextNeighborhood[i];
						if (newContext && newContext !== relatedMemory.context) {
							updatedNeighbor.updateContext(newContext);
							hasChanges = true;
						}
					}

					// Update tags if provided and different
					if (i < decision.newTagsNeighborhood.length) {
						const newTags = decision.newTagsNeighborhood[i];
						if (newTags && newTags.length > 0) {
							const currentTags = JSON.stringify(relatedMemory.tags.sort());
							const proposedTags = JSON.stringify(newTags.sort());
							if (currentTags !== proposedTags) {
								updatedNeighbor.updateTags(newTags);
								hasChanges = true;
							}
						}
					}

					// Only add to updated neighbors if there were actual changes
					if (hasChanges) {
						// Record evolution
						const evolution: MemoryEvolution = {
							timestamp: evolutionTimestamp,
							type: EVOLUTION_TYPES.UPDATE_NEIGHBOR,
							description: `Updated by neighbor memory ${memory.id} through A-MEM evolution`,
							involvedMemories: [memory.id],
							changes: {
								updatedContext: updatedNeighbor.context,
								updatedTags: updatedNeighbor.tags,
							},
						};
						updatedNeighbor.addEvolution(evolution);

						updatedNeighbors.push(updatedNeighbor);
					}
				}
			}
		}

		return { updatedMemory, updatedNeighbors };
	}

	/**
	 * Call LLM with retry logic
	 */
	private async callLLMWithRetry(prompt: string): Promise<string> {
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= this.performanceConfig.maxRetries; attempt++) {
			try {
				const systemPrompt = 'You are a memory evolution agent. Respond with valid JSON only.';
				const response = await Promise.race([
					this.llmService.directGenerate(prompt, systemPrompt),
					this.createTimeout(),
				]);

				if (typeof response === 'string' && response === 'TIMEOUT') {
					throw new Error('LLM request timed out');
				}

				return response;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (attempt < this.performanceConfig.maxRetries) {
					this.logger.warn(`${LOG_PREFIXES.EVOLUTION_ENGINE} LLM call failed, retrying`, {
						attempt,
						error: lastError.message,
					});

					await this.delay(this.performanceConfig.maxRetries * attempt);
				}
			}
		}

		throw lastError || new Error('LLM call failed after all retries');
	}

	/**
	 * Parse evolution decision from LLM response
	 */
	private parseEvolutionDecision(response: string): MemoryEvolutionDecision {
		try {
			const parsed = JSON.parse(response);

			// Handle both snake_case (from A-MEM paper) and camelCase formats
			return {
				shouldEvolve: Boolean(parsed.should_evolve ?? parsed.shouldEvolve),
				actions: Array.isArray(parsed.actions) ? parsed.actions : [],
				suggestedConnections: Array.isArray(
					parsed.suggested_connections ?? parsed.suggestedConnections
				)
					? (parsed.suggested_connections ?? parsed.suggestedConnections)
					: [],
				tagsToUpdate: Array.isArray(parsed.tags_to_update ?? parsed.tagsToUpdate)
					? (parsed.tags_to_update ?? parsed.tagsToUpdate)
					: [],
				newContextNeighborhood: Array.isArray(
					parsed.new_context_neighborhood ?? parsed.newContextNeighborhood
				)
					? (parsed.new_context_neighborhood ?? parsed.newContextNeighborhood)
					: [],
				newTagsNeighborhood: Array.isArray(
					parsed.new_tags_neighborhood ?? parsed.newTagsNeighborhood
				)
					? (parsed.new_tags_neighborhood ?? parsed.newTagsNeighborhood)
					: [],
			};
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.EVOLUTION_ENGINE} Failed to parse evolution decision`, {
				response,
				error: error instanceof Error ? error.message : String(error),
			});

			// Return default decision
			return {
				shouldEvolve: false,
				actions: [],
				suggestedConnections: [],
				tagsToUpdate: [],
				newContextNeighborhood: [],
				newTagsNeighborhood: [],
			};
		}
	}

	/**
	 * Create timeout promise
	 */
	private createTimeout(): Promise<string> {
		return new Promise(resolve => {
			setTimeout(() => {
				resolve('TIMEOUT');
			}, this.performanceConfig.llmTimeout);
		});
	}

	/**
	 * Delay for retry logic
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Get embedding for content
	 */
	private async getEmbedding(content: string): Promise<number[]> {
		if (!this.embeddingService) {
			throw new Error('Embedding service not available');
		}
		try {
			const embedding = await this.embeddingService.embed(content);
			return embedding;
		} catch (error) {
			throw new Error(`Failed to create embedding: ${error}`);
		}
	}
}
