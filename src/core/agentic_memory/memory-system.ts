/**
 * Agentic Memory System
 *
 * Main class for the agentic memory system integrated with cipher
 */

import { EventEmitter } from 'events';
import type {
	AgenticMemoryConfig,
	MemoryNote as IMemoryNote,
	MemorySearchResult,
	MemorySystemEvents,
	MemorySystemStatus,
	MemoryAnalytics,
	ConsolidationResult,
	MemoryRelationship,
	MemorySystemError,
} from './types.js';
import { MemoryNote } from './memory-note.js';
import { ContentAnalyzer } from './content-analyzer.js';
import { EvolutionEngine } from './evolution-engine.js';
import { MemoryBoxManager } from './memory-box.js';
import { LinkGenerator } from './link-generator.js';
import { validateAgenticMemoryConfig } from './config.js';
import {
	DEFAULT_CONFIG,
	ERROR_MESSAGES,
	LOG_PREFIXES,
	METADATA_KEYS,
	SEARCH_CONFIG,
	PERFORMANCE_CONFIG,
} from './constants.js';
import { createLogger } from '../logger/index.js';
import { env } from '../env.js';

/**
 * Agentic Memory System - Main class for managing memory operations
 */
export class AgenticMemorySystem extends EventEmitter {
	private readonly logger = createLogger({ level: env.CIPHER_LOG_LEVEL });
	private readonly memories = new Map<string, MemoryNote>();
	private readonly contentAnalyzer: ContentAnalyzer;
	private readonly evolutionEngine: EvolutionEngine;
	private readonly boxManager: MemoryBoxManager;
	private readonly linkGenerator: LinkGenerator;
	private evolutionCounter = 0;
	private isConnected = false;

	constructor(private readonly config: AgenticMemoryConfig) {
		super();

		// Validate configuration
		validateAgenticMemoryConfig(config);

		// Initialize components
		this.contentAnalyzer = new ContentAnalyzer(config.llmService);
		this.evolutionEngine = new EvolutionEngine(
			config.llmService,
			config.vectorStore,
			config.collectionName,
			config.maxRelatedMemories,
			config.embeddingService
		);
		this.boxManager = new MemoryBoxManager();
		this.linkGenerator = new LinkGenerator(
			config.llmService,
			config.vectorStore,
			config.embeddingService,
			this.boxManager,
			config.maxRelatedMemories
		);

		this.logger.info(`${LOG_PREFIXES.MEMORY_SYSTEM} Agentic Memory System initialized`, {
			collectionName: config.collectionName,
			evolutionThreshold: config.evolutionThreshold,
			autoEvolution: config.autoEvolution,
		});
	}

	/**
	 * Connect to the vector store and initialize collections
	 */
	async connect(): Promise<void> {
		this.logger.info(`${LOG_PREFIXES.MEMORY_SYSTEM} Connecting to vector store`);

		try {
			// Vector store should already be connected via factory
			// Just verify it's working
			const info = await this.config.vectorStoreManager.getInfo();
			this.logger.debug(`${LOG_PREFIXES.MEMORY_SYSTEM} Vector store info`, info);

			this.isConnected = true;
			this.logger.info(`${LOG_PREFIXES.MEMORY_SYSTEM} Successfully connected to vector store`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MEMORY_SYSTEM} Failed to connect to vector store`, {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Disconnect from the vector store
	 */
	async disconnect(): Promise<void> {
		this.logger.info(`${LOG_PREFIXES.MEMORY_SYSTEM} Disconnecting from vector store`);

		try {
			// Clear local memories and boxes
			this.memories.clear();
			// Clear all memory boxes
			for (const memoryId of Array.from(this.memories.keys())) {
				this.boxManager.removeMemoryFromBoxes(memoryId);
			}
			this.isConnected = false;

			this.logger.info(`${LOG_PREFIXES.MEMORY_SYSTEM} Successfully disconnected`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MEMORY_SYSTEM} Error during disconnect`, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Add a new memory note
	 */
	async addMemory(
		content: string,
		options?: {
			keywords?: string[];
			context?: string;
			tags?: string[];
			category?: string;
			metadata?: Record<string, any>;
			timestamp?: string;
		}
	): Promise<string> {
		this.logger.debug(`${LOG_PREFIXES.MEMORY_SYSTEM} Adding new memory`, {
			contentLength: content.length,
			hasOptions: Boolean(options),
		});

		this.ensureConnected();

		try {
			// Analyze content if not provided
			let analysis;
			if (!options?.keywords || !options?.context || !options?.tags) {
				analysis = await this.contentAnalyzer.analyzeContent(content);
			}

			// Create memory note
			const memory = new MemoryNote({
				content,
				keywords: options?.keywords || analysis?.keywords || [],
				context: options?.context || analysis?.context || DEFAULT_CONFIG.DEFAULT_CONTEXT,
				tags: options?.tags || analysis?.tags || [],
				category: options?.category || DEFAULT_CONFIG.DEFAULT_CATEGORY,
				metadata: options?.metadata,
				timestamp: options?.timestamp || undefined,
			});

			// A-MEM Note Construction and Link Generation Process
			// Step 1: Generate links using A-MEM methodology
			let finalMemory = memory;
			if (this.memories.size > 0) {
				try {
					const linkResult = await this.linkGenerator.generateLinks(memory, this.memories);

					// Update all affected memories with new relationships
					for (const updatedMemory of linkResult.updatedMemories) {
						this.memories.set(updatedMemory.id, updatedMemory);
						await this.updateVectorStore(updatedMemory);
					}

					// Add the new memory to storage
					this.memories.set(memory.id, memory);
					await this.addToVectorStore(memory);

					// Emit relationship events
					for (const relationship of linkResult.generatedLinks) {
						this.emit('memory:relationship_created', { relationship });
					}

					this.logger.info(`${LOG_PREFIXES.MEMORY_SYSTEM} A-MEM link generation completed`, {
						memoryId: memory.id,
						linksGenerated: linkResult.generatedLinks.length,
						boxId: linkResult.boxAssignment,
					});

					finalMemory = memory;
				} catch (error) {
					this.logger.warn(
						`${LOG_PREFIXES.MEMORY_SYSTEM} A-MEM link generation failed, adding memory without links`,
						{
							memoryId: memory.id,
							error: error instanceof Error ? error.message : String(error),
						}
					);

					// Fallback: just add memory without links
					this.memories.set(memory.id, memory);
					await this.addToVectorStore(memory);
				}
			} else {
				// First memory - just add it
				this.memories.set(memory.id, memory);
				await this.addToVectorStore(memory);
			}

			// Step 2: Process memory evolution if enabled (A-MEM workflow)
			if (this.config.autoEvolution && this.memories.size > 1) {
				try {
					const evolutionResult = await this.evolutionEngine.processMemory(
						finalMemory,
						this.memories
					);

					if (evolutionResult.shouldEvolve) {
						// Update the memory with evolution results (A-MEM evolution step)
						const updatedMemory = evolutionResult.updatedMemory;

						// Update neighbors in local storage and vector store
						for (const updatedNeighbor of evolutionResult.updatedNeighbors) {
							this.memories.set(updatedNeighbor.id, updatedNeighbor);
							await this.updateVectorStore(updatedNeighbor);
						}

						// Update the evolved memory
						this.memories.set(updatedMemory.id, updatedMemory);
						await this.updateVectorStore(updatedMemory);

						this.emit('memory:evolved', {
							memory: updatedMemory,
							evolution: updatedMemory.getLatestEvolution()!,
						});

						this.logger.info(`${LOG_PREFIXES.MEMORY_SYSTEM} A-MEM evolution completed`, {
							memoryId: updatedMemory.id,
							neighborsUpdated: evolutionResult.updatedNeighbors.length,
							newLinksCount: updatedMemory.links.length,
						});

						finalMemory = updatedMemory;
					}
				} catch (error) {
					this.logger.warn(
						`${LOG_PREFIXES.MEMORY_SYSTEM} A-MEM evolution failed, memory added without evolution`,
						{
							memoryId: finalMemory.id,
							error: error instanceof Error ? error.message : String(error),
						}
					);
				}
			}

			// Update evolution counter
			this.evolutionCounter++;

			// Trigger consolidation if threshold reached
			if (this.evolutionCounter % this.config.evolutionThreshold === 0) {
				this.consolidateMemories().catch(error => {
					this.logger.error(`${LOG_PREFIXES.MEMORY_SYSTEM} Background consolidation failed`, {
						error: error instanceof Error ? error.message : String(error),
					});
				});
			}

			this.emit('memory:added', { memory });

			this.logger.info(`${LOG_PREFIXES.MEMORY_SYSTEM} Memory added successfully`, {
				memoryId: memory.id,
				keywordCount: memory.keywords.length,
				tagCount: memory.tags.length,
			});

			return memory.id;
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MEMORY_SYSTEM} Failed to add memory`, {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Search for memories
	 */
	async searchMemories(
		query: string,
		options?: {
			k?: number;
			includeNeighbors?: boolean;
			similarityThreshold?: number;
		}
	): Promise<MemorySearchResult[]> {
		this.logger.debug(`${LOG_PREFIXES.MEMORY_SYSTEM} Searching memories`, {
			query,
			k: options?.k || SEARCH_CONFIG.DEFAULT_K,
		});

		this.ensureConnected();

		try {
			const k = Math.min(options?.k || SEARCH_CONFIG.DEFAULT_K, SEARCH_CONFIG.MAX_K);
			// Get embedding for the query first
			const embedding = await this.config.embeddingService.embed(query);
			const searchResults = await this.config.vectorStore.search(embedding, k);

			const results: MemorySearchResult[] = [];
			const seenIds = new Set<string>();

			// Process primary search results
			for (const result of searchResults) {
				const memoryId = String(result.id);
				if (memoryId && this.memories.has(memoryId) && !seenIds.has(memoryId)) {
					const memory = this.memories.get(memoryId)!;

					// Update access count
					memory.accessed();

					results.push({
						memory,
						score: result.score || 0,
						isNeighbor: false,
						relevance: {
							keywordMatch: this.calculateKeywordMatch(query, memory.keywords),
							semanticSimilarity: result.score || 0,
							contextRelevance: this.calculateContextRelevance(query, memory.context),
						},
					});

					seenIds.add(memoryId);
				}
			}

			// Add neighbor memories automatically (A-MEM workflow requirement)
			// When related memory is retrieved, similar memories within the same box are automatically accessed
			if (options?.includeNeighbors !== false) {
				// Default to true for A-MEM
				const originalResults = [...results];
				for (const result of originalResults) {
					// Add direct links first
					for (const linkId of result.memory.links) {
						if (!seenIds.has(linkId) && this.memories.has(linkId)) {
							const linkedMemory = this.memories.get(linkId)!;

							results.push({
								memory: linkedMemory,
								score: result.score * 0.9, // High score for direct links
								isNeighbor: true,
								relevance: {
									keywordMatch: this.calculateKeywordMatch(query, linkedMemory.keywords),
									semanticSimilarity: result.score * 0.9,
									contextRelevance: this.calculateContextRelevance(query, linkedMemory.context),
								},
							});

							seenIds.add(linkId);
						}
					}

					// Add contextually similar memories (box concept from A-MEM)
					const contextualMatches = Array.from(this.memories.values())
						.filter(
							m =>
								!seenIds.has(m.id) &&
								m.context === result.memory.context &&
								m.tags.some(tag => result.memory.tags.includes(tag))
						)
						.slice(0, 2); // Limit contextual matches per result

					for (const contextualMemory of contextualMatches) {
						results.push({
							memory: contextualMemory,
							score: result.score * 0.7, // Lower score for contextual matches
							isNeighbor: true,
							relevance: {
								keywordMatch: this.calculateKeywordMatch(query, contextualMemory.keywords),
								semanticSimilarity: result.score * 0.7,
								contextRelevance: this.calculateContextRelevance(query, contextualMemory.context),
							},
						});

						seenIds.add(contextualMemory.id);
					}
				}
			}

			// Apply similarity threshold filter
			const threshold = options?.similarityThreshold || SEARCH_CONFIG.DEFAULT_SIMILARITY_THRESHOLD;
			const filteredResults = results.filter(r => r.score >= threshold);

			this.logger.debug(`${LOG_PREFIXES.MEMORY_SYSTEM} Memory search completed`, {
				query,
				totalResults: filteredResults.length,
				primaryResults: results.filter(r => !r.isNeighbor).length,
				neighborResults: results.filter(r => r.isNeighbor).length,
			});

			return filteredResults.slice(0, k);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MEMORY_SYSTEM} Memory search failed`, {
				query,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Get memory by ID
	 */
	getMemory(id: string): MemoryNote | null {
		const memory = this.memories.get(id);
		if (memory) {
			memory.accessed();
		}
		return memory || null;
	}

	/**
	 * Update memory
	 */
	async updateMemory(
		id: string,
		updates: {
			content?: string;
			keywords?: string[];
			context?: string;
			tags?: string[];
			category?: string;
			metadata?: Record<string, any>;
		}
	): Promise<boolean> {
		this.logger.debug(`${LOG_PREFIXES.MEMORY_SYSTEM} Updating memory`, {
			memoryId: id,
			updates: Object.keys(updates),
		});

		this.ensureConnected();

		const memory = this.memories.get(id);
		if (!memory) {
			this.logger.warn(`${LOG_PREFIXES.MEMORY_SYSTEM} Memory not found for update`, {
				memoryId: id,
			});
			return false;
		}

		try {
			const originalMemory = { ...memory };

			// Apply updates
			if (updates.content !== undefined) {
				memory.updateContent(updates.content);

				// Re-analyze content if it changed
				const analysis = await this.contentAnalyzer.analyzeContent(updates.content);
				if (!updates.keywords) memory.updateKeywords(analysis.keywords);
				if (!updates.context) memory.updateContext(analysis.context);
				if (!updates.tags) memory.updateTags(analysis.tags);
			}

			if (updates.keywords !== undefined) memory.updateKeywords(updates.keywords);
			if (updates.context !== undefined) memory.updateContext(updates.context);
			if (updates.tags !== undefined) memory.updateTags(updates.tags);
			if (updates.category !== undefined) memory.updateCategory(updates.category);
			if (updates.metadata !== undefined) memory.updateMetadata(updates.metadata);

			// Update vector store
			await this.updateVectorStore(memory);

			this.emit('memory:updated', { memory, changes: updates });

			this.logger.info(`${LOG_PREFIXES.MEMORY_SYSTEM} Memory updated successfully`, {
				memoryId: id,
			});

			return true;
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MEMORY_SYSTEM} Failed to update memory`, {
				memoryId: id,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Delete memory
	 */
	async deleteMemory(id: string): Promise<boolean> {
		this.logger.debug(`${LOG_PREFIXES.MEMORY_SYSTEM} Deleting memory`, { memoryId: id });

		this.ensureConnected();

		const memory = this.memories.get(id);
		if (!memory) {
			this.logger.warn(`${LOG_PREFIXES.MEMORY_SYSTEM} Memory not found for deletion`, {
				memoryId: id,
			});
			return false;
		}

		try {
			// Remove from vector store
			// Convert string ID to numeric hash for vector store
			const numericId = this.hashStringToNumber(id);
			await this.config.vectorStore.delete(numericId);

			// Remove from local storage
			this.memories.delete(id);

			// Remove from memory boxes
			this.boxManager.removeMemoryFromBoxes(id);

			// Remove links from other memories
			for (const otherMemory of this.memories.values()) {
				if (otherMemory.isLinkedTo(id)) {
					otherMemory.removeLink(id);
					await this.updateVectorStore(otherMemory);
				}
			}

			this.emit('memory:deleted', { memoryId: id });

			this.logger.info(`${LOG_PREFIXES.MEMORY_SYSTEM} Memory deleted successfully`, {
				memoryId: id,
			});

			return true;
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MEMORY_SYSTEM} Failed to delete memory`, {
				memoryId: id,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Consolidate memories (batch processing)
	 */
	async consolidateMemories(): Promise<ConsolidationResult> {
		this.logger.info(`${LOG_PREFIXES.MEMORY_SYSTEM} Starting memory consolidation`);

		const startTime = Date.now();
		let processedCount = 0;
		let newRelationships = 0;
		let evolvedCount = 0;
		const errors: string[] = [];

		try {
			// Process memories in batches
			const memoryIds = Array.from(this.memories.keys());
			const batchSize = PERFORMANCE_CONFIG.BATCH_SIZE;

			for (let i = 0; i < memoryIds.length; i += batchSize) {
				const batch = memoryIds.slice(i, i + batchSize);

				for (const memoryId of batch) {
					try {
						const memory = this.memories.get(memoryId);
						if (!memory) continue;

						// Process evolution
						const evolutionResult = await this.evolutionEngine.processMemory(memory, this.memories);

						if (evolutionResult.shouldEvolve) {
							// Update memory
							this.memories.set(memoryId, evolutionResult.updatedMemory);
							await this.updateVectorStore(evolutionResult.updatedMemory);

							// Update neighbors
							for (const updatedNeighbor of evolutionResult.updatedNeighbors) {
								this.memories.set(updatedNeighbor.id, updatedNeighbor);
								await this.updateVectorStore(updatedNeighbor);
							}

							evolvedCount++;
							newRelationships += evolutionResult.updatedMemory.links.length;
						}

						processedCount++;
					} catch (error) {
						const errorMsg = `Failed to process memory ${memoryId}: ${error instanceof Error ? error.message : String(error)}`;
						errors.push(errorMsg);
						this.logger.error(errorMsg);
					}
				}
			}

			// Consolidate memory boxes
			const boxConsolidation = await this.boxManager.consolidateBoxes(this.memories);

			const result: ConsolidationResult = {
				processedCount,
				newRelationships,
				evolvedCount,
				processingTime: Date.now() - startTime,
				errors,
			};

			this.emit('memory:consolidated', { result });

			this.logger.info(`${LOG_PREFIXES.MEMORY_SYSTEM} Memory consolidation completed`, {
				...result,
				boxesMerged: boxConsolidation.mergedBoxes,
				totalBoxes: boxConsolidation.totalBoxes,
			});

			return result;
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MEMORY_SYSTEM} Memory consolidation failed`, {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Get memory analytics
	 */
	getAnalytics(): MemoryAnalytics {
		const memories = Array.from(this.memories.values());

		const totalMemories = memories.length;
		const totalRelationships = memories.reduce((sum, m) => sum + m.links.length, 0);
		const avgRetrievalCount =
			memories.reduce((sum, m) => sum + m.retrievalCount, 0) / totalMemories || 0;

		const topMemories = memories.sort((a, b) => b.retrievalCount - a.retrievalCount).slice(0, 10);

		const categoryDistribution: Record<string, number> = {};
		const tagDistribution: Record<string, number> = {};

		for (const memory of memories) {
			categoryDistribution[memory.category] = (categoryDistribution[memory.category] || 0) + 1;

			for (const tag of memory.tags) {
				tagDistribution[tag] = (tagDistribution[tag] || 0) + 1;
			}
		}

		const allEvolutions = memories.flatMap(m => m.evolutionHistory);
		const evolutionsByType: Record<string, number> = {};

		for (const evolution of allEvolutions) {
			evolutionsByType[evolution.type] = (evolutionsByType[evolution.type] || 0) + 1;
		}

		return {
			totalMemories,
			totalRelationships,
			avgRetrievalCount,
			topMemories,
			categoryDistribution,
			tagDistribution,
			evolutionStats: {
				totalEvolutions: allEvolutions.length,
				evolutionsByType,
				lastEvolutionTimestamp:
					allEvolutions.length > 0 ? allEvolutions[allEvolutions.length - 1]?.timestamp || '' : '',
			},
		};
	}

	/**
	 * Get system status
	 */
	getStatus(): MemorySystemStatus {
		return {
			connected: this.isConnected,
			memoryCount: this.memories.size,
			evolutionCounter: this.evolutionCounter,
			lastEvolution: this.getLastEvolutionTimestamp(),
			health: this.isConnected ? 'healthy' : 'error',
			errors: [],
		};
	}

	/**
	 * Add memory to vector store
	 */
	private async addToVectorStore(memory: MemoryNote): Promise<void> {
		const embedding = await this.config.embeddingService.embed(memory.content);

		const metadata = {
			[METADATA_KEYS.ID]: memory.id,
			[METADATA_KEYS.CONTENT]: memory.content,
			[METADATA_KEYS.KEYWORDS]: JSON.stringify(memory.keywords),
			[METADATA_KEYS.CONTEXT]: memory.context,
			[METADATA_KEYS.TAGS]: JSON.stringify(memory.tags),
			[METADATA_KEYS.LINKS]: JSON.stringify(memory.links),
			[METADATA_KEYS.CATEGORY]: memory.category,
			[METADATA_KEYS.TIMESTAMP]: memory.timestamp,
			[METADATA_KEYS.LAST_ACCESSED]: memory.lastAccessed,
			[METADATA_KEYS.RETRIEVAL_COUNT]: memory.retrievalCount.toString(),
			[METADATA_KEYS.EVOLUTION_HISTORY]: JSON.stringify(memory.evolutionHistory),
			[METADATA_KEYS.METADATA]: JSON.stringify(memory.metadata || {}),
		};

		// Convert string ID to numeric hash for vector store
		const numericId = this.hashStringToNumber(memory.id);
		const payload = { ...metadata };
		await this.config.vectorStore.insert([embedding], [numericId], [payload]);
	}

	/**
	 * Update memory in vector store
	 */
	private async updateVectorStore(memory: MemoryNote): Promise<void> {
		// Delete old version
		// Convert string ID to numeric hash for vector store
		const numericId = this.hashStringToNumber(memory.id);
		await this.config.vectorStore.delete(numericId);

		// Insert updated version
		await this.addToVectorStore(memory);
	}

	/**
	 * Calculate keyword match score
	 */
	private calculateKeywordMatch(query: string, keywords: string[]): number {
		if (keywords.length === 0) return 0;

		const queryWords = query.toLowerCase().split(/\s+/);
		const keywordWords = keywords.map(k => k.toLowerCase());

		const matches = queryWords.filter(word =>
			keywordWords.some(keyword => keyword.includes(word) || word.includes(keyword))
		);

		return matches.length / queryWords.length;
	}

	/**
	 * Calculate context relevance score
	 */
	private calculateContextRelevance(query: string, context: string): number {
		const queryWords = query.toLowerCase().split(/\s+/);
		const contextWords = context.toLowerCase().split(/\s+/);

		const matches = queryWords.filter(word =>
			contextWords.some(contextWord => contextWord.includes(word) || word.includes(contextWord))
		);

		return matches.length / queryWords.length;
	}

	/**
	 * Get last evolution timestamp
	 */
	private getLastEvolutionTimestamp(): string | null {
		let latestTimestamp: string | null = null;

		for (const memory of this.memories.values()) {
			const latestEvolution = memory.getLatestEvolution();
			if (latestEvolution && (!latestTimestamp || latestEvolution.timestamp > latestTimestamp)) {
				latestTimestamp = latestEvolution.timestamp;
			}
		}

		return latestTimestamp;
	}

	/**
	 * Ensure system is connected
	 */
	private ensureConnected(): void {
		if (!this.isConnected) {
			throw new Error(ERROR_MESSAGES.SYSTEM_NOT_CONNECTED);
		}
	}

	/**
	 * Hash a string to a number for vector store compatibility
	 */
	private hashStringToNumber(str: string): number {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return Math.abs(hash);
	}
}
