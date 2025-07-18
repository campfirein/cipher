/**
 * A-MEM Configuration
 *
 * Configuration management for the Agentic Memory system
 */

import { z } from 'zod';
import { env } from '../env.js';
import { DEFAULT_CONFIG } from './constants.js';
import type { AgenticMemoryConfig } from './types.js';
import type { VectorStore } from '../vector_storage/backend/vector-store.js';
import type { ILLMService } from '../brain/llm/services/types.js';
import type { Embedder } from '../brain/embedding/types.js';

/**
 * Environment schema for A-MEM configuration
 */
const agenticMemoryEnvSchema = z.object({
	// Memory Collection Configuration
	AGENTIC_MEMORY_COLLECTION: z.string().default(DEFAULT_CONFIG.COLLECTION_NAME),
	AGENTIC_MEMORY_EVOLUTION_COLLECTION: z.string().default(DEFAULT_CONFIG.EVOLUTION_COLLECTION_NAME),

	// Evolution Configuration
	AGENTIC_MEMORY_EVOLUTION_THRESHOLD: z.number().default(DEFAULT_CONFIG.EVOLUTION_THRESHOLD),
	AGENTIC_MEMORY_MAX_RELATED: z.number().default(DEFAULT_CONFIG.MAX_RELATED_MEMORIES),
	AGENTIC_MEMORY_SIMILARITY_THRESHOLD: z.number().default(DEFAULT_CONFIG.SIMILARITY_THRESHOLD),
	AGENTIC_MEMORY_AUTO_EVOLUTION: z.boolean().default(DEFAULT_CONFIG.AUTO_EVOLUTION),

	// Search Configuration
	AGENTIC_MEMORY_MAX_SEARCH_RESULTS: z.number().default(DEFAULT_CONFIG.MAX_SEARCH_RESULTS),

	// Performance Configuration
	AGENTIC_MEMORY_BATCH_SIZE: z.number().default(100),
	AGENTIC_MEMORY_LLM_TIMEOUT: z.number().default(30000),
	AGENTIC_MEMORY_VECTOR_TIMEOUT: z.number().default(10000),
	AGENTIC_MEMORY_MAX_RETRIES: z.number().default(3),

	// Feature Flags
	AGENTIC_MEMORY_ENABLED: z.boolean().default(true),
	AGENTIC_MEMORY_ANALYTICS_ENABLED: z.boolean().default(true),
	AGENTIC_MEMORY_DEBUG_MODE: z.boolean().default(false),
});

/**
 * Environment variables for A-MEM with proper types
 */
export const agenticMemoryEnv = new Proxy({} as z.infer<typeof agenticMemoryEnvSchema>, {
	get(target, prop: string): any {
		switch (prop) {
			case 'AGENTIC_MEMORY_COLLECTION':
				return env.AGENTIC_MEMORY_COLLECTION;
			case 'AGENTIC_MEMORY_EVOLUTION_COLLECTION':
				return env.AGENTIC_MEMORY_EVOLUTION_COLLECTION;
			case 'AGENTIC_MEMORY_EVOLUTION_THRESHOLD':
				return env.AGENTIC_MEMORY_EVOLUTION_THRESHOLD;
			case 'AGENTIC_MEMORY_MAX_RELATED':
				return env.AGENTIC_MEMORY_MAX_RELATED;
			case 'AGENTIC_MEMORY_SIMILARITY_THRESHOLD':
				return env.AGENTIC_MEMORY_SIMILARITY_THRESHOLD;
			case 'AGENTIC_MEMORY_AUTO_EVOLUTION':
				return env.AGENTIC_MEMORY_AUTO_EVOLUTION;
			case 'AGENTIC_MEMORY_MAX_SEARCH_RESULTS':
				return env.AGENTIC_MEMORY_MAX_SEARCH_RESULTS;
			case 'AGENTIC_MEMORY_BATCH_SIZE':
				return env.AGENTIC_MEMORY_BATCH_SIZE;
			case 'AGENTIC_MEMORY_LLM_TIMEOUT':
				return env.AGENTIC_MEMORY_LLM_TIMEOUT;
			case 'AGENTIC_MEMORY_VECTOR_TIMEOUT':
				return env.AGENTIC_MEMORY_VECTOR_TIMEOUT;
			case 'AGENTIC_MEMORY_MAX_RETRIES':
				return env.AGENTIC_MEMORY_MAX_RETRIES;
			case 'AGENTIC_MEMORY_ENABLED':
				return env.AGENTIC_MEMORY_ENABLED;
			case 'AGENTIC_MEMORY_ANALYTICS_ENABLED':
				return env.AGENTIC_MEMORY_ANALYTICS_ENABLED;
			case 'AGENTIC_MEMORY_DEBUG_MODE':
				return env.AGENTIC_MEMORY_DEBUG_MODE;
			default:
				return undefined;
		}
	},
});

/**
 * Configuration validation
 */
export function validateAgenticMemoryConfig(config: Partial<AgenticMemoryConfig>): void {
	if (!config.vectorStoreManager) {
		throw new Error('Vector store manager is required for Agentic Memory');
	}

	if (!config.vectorStore) {
		throw new Error('Vector store is required for Agentic Memory');
	}

	if (!config.llmService) {
		throw new Error('LLM service is required for Agentic Memory');
	}

	if (!config.embeddingService) {
		throw new Error('Embedding service is required for Agentic Memory');
	}

	if (config.evolutionThreshold && config.evolutionThreshold < 1) {
		throw new Error('Evolution threshold must be at least 1');
	}

	if (config.maxRelatedMemories && config.maxRelatedMemories < 1) {
		throw new Error('Max related memories must be at least 1');
	}

	if (
		config.similarityThreshold &&
		(config.similarityThreshold < 0 || config.similarityThreshold > 1)
	) {
		throw new Error('Similarity threshold must be between 0 and 1');
	}

	if (config.maxSearchResults && config.maxSearchResults < 1) {
		throw new Error('Max search results must be at least 1');
	}
}

/**
 * Create default configuration for Agentic Memory
 */
export function createDefaultAgenticMemoryConfig(
	vectorStoreManager: any,
	vectorStore: VectorStore,
	llmService: ILLMService,
	embeddingService: Embedder
): AgenticMemoryConfig {
	return {
		vectorStoreManager,
		vectorStore,
		llmService,
		embeddingService,
		collectionName: getMemoryCollectionName(),
		evolutionCollectionName: getMemoryEvolutionCollectionName(),
		evolutionThreshold: getEvolutionThreshold(),
		maxRelatedMemories: getMaxRelatedMemories(),
		similarityThreshold: env.AGENTIC_MEMORY_SIMILARITY_THRESHOLD,
		autoEvolution: getAutoEvolution(),
		maxSearchResults: env.AGENTIC_MEMORY_MAX_SEARCH_RESULTS,
	};
}

/**
 * Create configuration from environment variables
 */
export function createAgenticMemoryConfigFromEnv(
	vectorStoreManager: any,
	vectorStore: VectorStore,
	llmService: ILLMService,
	embeddingService: Embedder
): AgenticMemoryConfig {
	const config = createDefaultAgenticMemoryConfig(
		vectorStoreManager,
		vectorStore,
		llmService,
		embeddingService
	);

	// Validate the configuration
	validateAgenticMemoryConfig(config);

	return config;
}

/**
 * Configuration builder for more complex setups
 */
export class AgenticMemoryConfigBuilder {
	private config: Partial<AgenticMemoryConfig> = {};

	constructor() {
		// Set defaults from environment (mode-aware)
		this.config.collectionName = getMemoryCollectionName();
		this.config.evolutionCollectionName = getMemoryEvolutionCollectionName();
		this.config.evolutionThreshold = getEvolutionThreshold();
		this.config.maxRelatedMemories = getMaxRelatedMemories();
		this.config.similarityThreshold = env.AGENTIC_MEMORY_SIMILARITY_THRESHOLD;
		this.config.autoEvolution = getAutoEvolution();
		this.config.maxSearchResults = env.AGENTIC_MEMORY_MAX_SEARCH_RESULTS;
	}

	/**
	 * Set the vector store
	 */
	vectorStore(vectorStore: VectorStore): this {
		this.config.vectorStore = vectorStore;
		return this;
	}

	/**
	 * Set the LLM service
	 */
	llmService(llmService: ILLMService): this {
		this.config.llmService = llmService;
		return this;
	}

	/**
	 * Set the embedding service
	 */
	embeddingService(embeddingService: Embedder): this {
		this.config.embeddingService = embeddingService;
		return this;
	}

	/**
	 * Set the collection name
	 */
	collectionName(collectionName: string): this {
		this.config.collectionName = collectionName;
		return this;
	}

	/**
	 * Set the evolution collection name
	 */
	evolutionCollectionName(evolutionCollectionName: string): this {
		this.config.evolutionCollectionName = evolutionCollectionName;
		return this;
	}

	/**
	 * Set the evolution threshold
	 */
	evolutionThreshold(threshold: number): this {
		this.config.evolutionThreshold = threshold;
		return this;
	}

	/**
	 * Set the maximum related memories
	 */
	maxRelatedMemories(max: number): this {
		this.config.maxRelatedMemories = max;
		return this;
	}

	/**
	 * Set the similarity threshold
	 */
	similarityThreshold(threshold: number): this {
		this.config.similarityThreshold = threshold;
		return this;
	}

	/**
	 * Enable or disable auto evolution
	 */
	autoEvolution(enabled: boolean): this {
		this.config.autoEvolution = enabled;
		return this;
	}

	/**
	 * Set the maximum search results
	 */
	maxSearchResults(max: number): this {
		this.config.maxSearchResults = max;
		return this;
	}

	/**
	 * Build the configuration
	 */
	build(): AgenticMemoryConfig {
		validateAgenticMemoryConfig(this.config);
		return this.config as AgenticMemoryConfig;
	}
}

/**
 * Check if Agentic Memory is enabled
 */
export function isAgenticMemoryEnabled(): boolean {
	return env.AGENTIC_MEMORY_ENABLED || env.AGENTIC_MEMORY_MODE !== 'disabled';
}

/**
 * Check if A-MEM is in MemAgent mode
 */
export function isMemAgentMode(): boolean {
	return env.AGENTIC_MEMORY_MODE === 'memagent';
}

/**
 * Get the appropriate collection name based on mode
 */
export function getMemoryCollectionName(): string {
	if (isMemAgentMode()) {
		return env.MEMAGENT_AGENTIC_MEMORY_COLLECTION;
	}
	return env.AGENTIC_MEMORY_COLLECTION;
}

/**
 * Get the appropriate evolution collection name based on mode
 */
export function getMemoryEvolutionCollectionName(): string {
	if (isMemAgentMode()) {
		return env.MEMAGENT_AGENTIC_MEMORY_EVOLUTION_COLLECTION;
	}
	return env.AGENTIC_MEMORY_EVOLUTION_COLLECTION;
}

/**
 * Get the appropriate evolution threshold based on mode
 */
export function getEvolutionThreshold(): number {
	if (isMemAgentMode()) {
		return env.MEMAGENT_AGENTIC_MEMORY_EVOLUTION_THRESHOLD;
	}
	return env.AGENTIC_MEMORY_EVOLUTION_THRESHOLD;
}

/**
 * Get the appropriate max related memories based on mode
 */
export function getMaxRelatedMemories(): number {
	if (isMemAgentMode()) {
		return env.MEMAGENT_AGENTIC_MEMORY_MAX_RELATED;
	}
	return env.AGENTIC_MEMORY_MAX_RELATED;
}

/**
 * Get the appropriate auto evolution setting based on mode
 */
export function getAutoEvolution(): boolean {
	if (isMemAgentMode()) {
		return env.MEMAGENT_AGENTIC_MEMORY_AUTO_EVOLUTION;
	}
	return env.AGENTIC_MEMORY_AUTO_EVOLUTION;
}

/**
 * Check if debug mode is enabled
 */
export function isDebugMode(): boolean {
	return agenticMemoryEnv.AGENTIC_MEMORY_DEBUG_MODE;
}

/**
 * Check if analytics are enabled
 */
export function isAnalyticsEnabled(): boolean {
	return agenticMemoryEnv.AGENTIC_MEMORY_ANALYTICS_ENABLED;
}

/**
 * Get performance configuration
 */
export function getPerformanceConfig() {
	return {
		batchSize: agenticMemoryEnv.AGENTIC_MEMORY_BATCH_SIZE,
		llmTimeout: agenticMemoryEnv.AGENTIC_MEMORY_LLM_TIMEOUT,
		vectorTimeout: agenticMemoryEnv.AGENTIC_MEMORY_VECTOR_TIMEOUT,
		maxRetries: agenticMemoryEnv.AGENTIC_MEMORY_MAX_RETRIES,
	};
}
