/**
 * Agentic Memory Factory
 *
 * Factory functions for creating and configuring the agentic memory system
 */

import { AgenticMemorySystem } from './memory-system.js';
import { AgenticMemoryConfigBuilder, createAgenticMemoryConfigFromEnv } from './config.js';
import type { AgenticMemoryConfig } from './types.js';
import type { VectorStore } from '../vector_storage/backend/vector-store.js';
import type { ILLMService } from '../brain/llm/services/types.js';
import type { Embedder } from '../brain/embedding/types.js';
import { createLogger } from '../logger/index.js';
import { env } from '../env.js';
import { LOG_PREFIXES } from './constants.js';

/**
 * Factory result containing the memory system and configuration
 */
export interface AgenticMemoryFactory {
	/** The agentic memory system instance */
	system: AgenticMemorySystem;
	/** The configuration used to create the system */
	config: AgenticMemoryConfig;
}

/**
 * Create an agentic memory system with the provided configuration
 */
export async function createAgenticMemorySystem(
	config: AgenticMemoryConfig
): Promise<AgenticMemoryFactory> {
	const logger = createLogger({ level: env.CIPHER_LOG_LEVEL });

	logger.debug(`${LOG_PREFIXES.MEMORY_SYSTEM} Creating agentic memory system`, {
		collectionName: config.collectionName,
		evolutionThreshold: config.evolutionThreshold,
		autoEvolution: config.autoEvolution,
	});

	try {
		const system = new AgenticMemorySystem(config);
		await system.connect();

		logger.info(`${LOG_PREFIXES.MEMORY_SYSTEM} Agentic memory system created successfully`);

		return { system, config };
	} catch (error) {
		logger.error(`${LOG_PREFIXES.MEMORY_SYSTEM} Failed to create agentic memory system`, {
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

/**
 * Create an agentic memory system from environment variables
 */
export async function createAgenticMemorySystemFromEnv(
	vectorStoreManager: any,
	llmService: ILLMService,
	embeddingService: Embedder
): Promise<AgenticMemoryFactory> {
	const vectorStore = vectorStoreManager.getStore('knowledge');
	const config = createAgenticMemoryConfigFromEnv(
		vectorStoreManager,
		vectorStore,
		llmService,
		embeddingService
	);
	return createAgenticMemorySystem(config);
}

/**
 * Create an agentic memory system with custom configuration
 */
export async function createCustomAgenticMemorySystem(
	vectorStore: VectorStore,
	llmService: ILLMService,
	embeddingService: Embedder,
	customizer?: (builder: AgenticMemoryConfigBuilder) => AgenticMemoryConfigBuilder
): Promise<AgenticMemoryFactory> {
	let builder = new AgenticMemoryConfigBuilder()
		.vectorStore(vectorStore)
		.llmService(llmService)
		.embeddingService(embeddingService);

	if (customizer) {
		builder = customizer(builder);
	}

	const config = builder.build();
	return createAgenticMemorySystem(config);
}

/**
 * Create an agentic memory system with default settings
 */
export async function createDefaultAgenticMemorySystem(
	vectorStore: VectorStore,
	llmService: ILLMService,
	embeddingService: Embedder
): Promise<AgenticMemoryFactory> {
	return createAgenticMemorySystemFromEnv(vectorStore, llmService, embeddingService);
}

/**
 * Create an agentic memory system for testing
 */
export async function createTestAgenticMemorySystem(
	vectorStore: VectorStore,
	llmService: ILLMService,
	embeddingService: Embedder
): Promise<AgenticMemoryFactory> {
	const config = new AgenticMemoryConfigBuilder()
		.vectorStore(vectorStore)
		.llmService(llmService)
		.embeddingService(embeddingService)
		.collectionName('test_memories')
		.evolutionCollectionName('test_evolution')
		.evolutionThreshold(10)
		.maxRelatedMemories(3)
		.similarityThreshold(0.5)
		.autoEvolution(false)
		.maxSearchResults(5)
		.build();

	return createAgenticMemorySystem(config);
}

/**
 * Create an agentic memory system with high performance settings
 */
export async function createHighPerformanceAgenticMemorySystem(
	vectorStore: VectorStore,
	llmService: ILLMService,
	embeddingService: Embedder
): Promise<AgenticMemoryFactory> {
	const config = new AgenticMemoryConfigBuilder()
		.vectorStore(vectorStore)
		.llmService(llmService)
		.embeddingService(embeddingService)
		.collectionName('hp_memories')
		.evolutionThreshold(50)
		.maxRelatedMemories(10)
		.similarityThreshold(0.8)
		.autoEvolution(true)
		.maxSearchResults(20)
		.build();

	return createAgenticMemorySystem(config);
}

/**
 * Create an agentic memory system with minimal evolution
 */
export async function createMinimalEvolutionAgenticMemorySystem(
	vectorStore: VectorStore,
	llmService: ILLMService,
	embeddingService: Embedder
): Promise<AgenticMemoryFactory> {
	const config = new AgenticMemoryConfigBuilder()
		.vectorStore(vectorStore)
		.llmService(llmService)
		.embeddingService(embeddingService)
		.collectionName('minimal_memories')
		.evolutionThreshold(1000)
		.maxRelatedMemories(3)
		.similarityThreshold(0.9)
		.autoEvolution(false)
		.maxSearchResults(5)
		.build();

	return createAgenticMemorySystem(config);
}

/**
 * Type guard to check if an object is an AgenticMemoryFactory
 */
export function isAgenticMemoryFactory(obj: unknown): obj is AgenticMemoryFactory {
	return (
		typeof obj === 'object' &&
		obj !== null &&
		'system' in obj &&
		'config' in obj &&
		obj.system instanceof AgenticMemorySystem
	);
}

/**
 * Validate that required services are available
 */
export function validateRequiredServices(
	vectorStore: VectorStore,
	llmService: ILLMService,
	embeddingService: Embedder
): void {
	if (!vectorStore) {
		throw new Error('Vector store is required for agentic memory system');
	}

	if (!llmService) {
		throw new Error('LLM service is required for agentic memory system');
	}

	if (!embeddingService) {
		throw new Error('Embedding service is required for agentic memory system');
	}
}

/**
 * Create agentic memory system with automatic service validation
 */
export async function createValidatedAgenticMemorySystem(
	vectorStore: VectorStore,
	llmService: ILLMService,
	embeddingService: Embedder,
	customizer?: (builder: AgenticMemoryConfigBuilder) => AgenticMemoryConfigBuilder
): Promise<AgenticMemoryFactory> {
	// Validate services first
	validateRequiredServices(vectorStore, llmService, embeddingService);

	// Create system
	return createCustomAgenticMemorySystem(vectorStore, llmService, embeddingService, customizer);
}

/**
 * Create multiple agentic memory systems for different use cases
 */
export async function createMultipleAgenticMemorySystems(
	vectorStore: VectorStore,
	llmService: ILLMService,
	embeddingService: Embedder,
	configs: {
		knowledge?: boolean;
		reflection?: boolean;
		analysis?: boolean;
		longTerm?: boolean;
	}
): Promise<{
	knowledge?: AgenticMemoryFactory;
	reflection?: AgenticMemoryFactory;
	analysis?: AgenticMemoryFactory;
	longTerm?: AgenticMemoryFactory;
}> {
	const systems: {
		knowledge?: AgenticMemoryFactory;
		reflection?: AgenticMemoryFactory;
		analysis?: AgenticMemoryFactory;
		longTerm?: AgenticMemoryFactory;
	} = {};

	if (configs.knowledge) {
		systems.knowledge = await createCustomAgenticMemorySystem(
			vectorStore,
			llmService,
			embeddingService,
			builder =>
				builder
					.collectionName('knowledge_memories')
					.evolutionThreshold(100)
					.maxRelatedMemories(5)
					.autoEvolution(true)
		);
	}

	if (configs.reflection) {
		systems.reflection = await createCustomAgenticMemorySystem(
			vectorStore,
			llmService,
			embeddingService,
			builder =>
				builder
					.collectionName('reflection_memories')
					.evolutionThreshold(50)
					.maxRelatedMemories(3)
					.autoEvolution(true)
		);
	}

	if (configs.analysis) {
		systems.analysis = await createCustomAgenticMemorySystem(
			vectorStore,
			llmService,
			embeddingService,
			builder =>
				builder
					.collectionName('analysis_memories')
					.evolutionThreshold(25)
					.maxRelatedMemories(10)
					.autoEvolution(true)
		);
	}

	if (configs.longTerm) {
		systems.longTerm = await createCustomAgenticMemorySystem(
			vectorStore,
			llmService,
			embeddingService,
			builder =>
				builder
					.collectionName('longterm_memories')
					.evolutionThreshold(500)
					.maxRelatedMemories(20)
					.autoEvolution(true)
		);
	}

	return systems;
}
