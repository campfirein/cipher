/**
 * Enhanced Service Initializer with Lazy Loading Support
 *
 * Extends the existing service initializer to support lazy loading of expensive services.
 * This provides backward compatibility while adding performance optimizations.
 */

import { AgentConfig } from '../memAgent/config.js';
import { createAgentServices } from '../../utils/service-initializer.js';
import { logger } from '../../logger/index.js';
import { EmbeddingManager } from '../embedding/index.js';
import { VectorStoreManager, DualCollectionVectorManager } from '../../vector_storage/index.js';
import { ILLMService } from '../llm/index.js';
import { createLLMService } from '../llm/services/factory.js';
import { createContextManager } from '../llm/messages/factory.js';
import {
	createVectorStoreFromEnv,
	createDualCollectionVectorStoreFromEnv,
} from '../../vector_storage/factory.js';
import { env } from '../../env.js';
import {
	LazyEmbeddingManager,
	LazyVectorStoreManager,
	LazyLLMService,
	type LazyAgentServices,
	type LazyServiceConfig,
	getDefaultLazyConfig,
} from './lazy-service-wrapper.js';

// Re-export LazyAgentServices for external use
export type { LazyAgentServices };

/**
 * Enhanced service creation options
 */
export interface EnhancedServiceOptions {
	/**
	 * Enable lazy loading optimizations
	 */
	enableLazyLoading?: boolean;

	/**
	 * Lazy loading configuration
	 */
	lazyConfig?: LazyServiceConfig;

	/**
	 * App mode for service initialization
	 */
	appMode?: 'cli' | 'mcp' | 'api' | undefined;
}

/**
 * Create agent services with optional lazy loading support
 */
export async function createEnhancedAgentServices(
	agentConfig: AgentConfig,
	options: EnhancedServiceOptions = {}
): Promise<LazyAgentServices> {
	const startTime = Date.now();

	// Get lazy loading configuration
	const lazyConfig: LazyServiceConfig = {
		...getDefaultLazyConfig(),
		...options.lazyConfig,
		// Override with explicit option
		...(options.enableLazyLoading !== undefined && {
			enableEmbeddingLazy: options.enableLazyLoading,
			enableVectorStoreLazy: options.enableLazyLoading,
			enableLLMServiceLazy: options.enableLazyLoading,
		}),
	};

	const shouldUseLazyLoading =
		options.enableLazyLoading ??
		(env.ENABLE_LAZY_LOADING === 'true' || lazyConfig.skipHeavyServicesOnStartup);

	logger.debug('EnhancedServiceInitializer: Starting service initialization', {
		lazyLoading: shouldUseLazyLoading,
		appMode: options.appMode,
		skipHeavyServices: lazyConfig.skipHeavyServicesOnStartup,
	});

	if (!shouldUseLazyLoading) {
		// Use standard service initialization
		logger.debug('EnhancedServiceInitializer: Using standard service initialization');
		const services = await createAgentServices(agentConfig, options.appMode);
		const initTime = Date.now() - startTime;

		logger.debug(`EnhancedServiceInitializer: Standard initialization completed in ${initTime}ms`);

		return {
			...services,
			lazyConfig,
		};
	}

	// Use lazy loading initialization
	logger.debug('EnhancedServiceInitializer: Using lazy loading initialization');

	// Create a modified config that skips heavy services initially
	const modifiedConfig = { ...agentConfig };

	// Temporarily disable embedding if lazy loading is enabled for it
	let originalEmbeddingConfig: any = null;
	if (lazyConfig.enableEmbeddingLazy && lazyConfig.skipHeavyServicesOnStartup) {
		originalEmbeddingConfig = modifiedConfig.embedding;
		(modifiedConfig as any).embedding = { disabled: true };
	}

	// Create core services (lightweight initialization)
	const coreServices = await createAgentServices(modifiedConfig, options.appMode);

	// Restore original config
	if (originalEmbeddingConfig !== null) {
		(modifiedConfig as any).embedding = originalEmbeddingConfig;
	}

	// Create lazy service wrappers
	const lazyServices: LazyAgentServices = {
		...coreServices,
		lazyConfig,
	};

	// Create lazy embedding manager if needed
	if (lazyConfig.enableEmbeddingLazy) {
		lazyServices.lazyEmbeddingManager = new LazyEmbeddingManager(async () => {
			logger.debug('LazyEmbeddingManager: Creating embedding manager');
			const embeddingManager = new EmbeddingManager();

			if (agentConfig.embedding && typeof agentConfig.embedding === 'object') {
				const result = await embeddingManager.createEmbedderFromConfig(
					agentConfig.embedding as any,
					'default'
				);
				if (!result) {
					throw new Error('Failed to create embedder from config');
				}
			}

			return embeddingManager;
		}, lazyConfig);

		// Remove the original embedding manager to ensure lazy loading is used
		if (lazyConfig.skipHeavyServicesOnStartup) {
			delete lazyServices.embeddingManager;
		}
	}

	// Create lazy vector store manager if needed
	if (lazyConfig.enableVectorStoreLazy) {
		lazyServices.lazyVectorStoreManager = new LazyVectorStoreManager(async () => {
			logger.debug('LazyVectorStoreManager: Creating vector store manager');

			// Check if reflection memory is enabled
			const reflectionEnabled =
				!env.DISABLE_REFLECTION_MEMORY &&
				env.REFLECTION_VECTOR_STORE_COLLECTION &&
				env.REFLECTION_VECTOR_STORE_COLLECTION.trim() !== '';

			if (reflectionEnabled) {
				const { manager } = await createDualCollectionVectorStoreFromEnv(agentConfig);
				return manager;
			} else {
				const { manager } = await createVectorStoreFromEnv(agentConfig);
				return manager;
			}
		}, lazyConfig);
	}

	// Create lazy LLM service if needed
	if (lazyConfig.enableLLMServiceLazy) {
		lazyServices.lazyLLMService = new LazyLLMService(async () => {
			logger.debug('LazyLLMService: Creating LLM service');

			const llmConfig = { ...agentConfig.llm, maxIterations: agentConfig.llm.maxIterations || 50 };
			const contextManager = createContextManager(
				llmConfig,
				coreServices.promptManager,
				undefined,
				undefined
			);

			const llmService = createLLMService(llmConfig, coreServices.mcpManager, contextManager);

			return llmService;
		}, lazyConfig);

		// Remove the original LLM service to ensure lazy loading is used
		if (lazyConfig.skipHeavyServicesOnStartup) {
			delete lazyServices.llmService;
		}
	}

	const initTime = Date.now() - startTime;

	logger.info('EnhancedServiceInitializer: Lazy initialization completed', {
		initTime: `${initTime}ms`,
		lazyEmbedding: !!lazyServices.lazyEmbeddingManager,
		lazyVectorStore: !!lazyServices.lazyVectorStoreManager,
		lazyLLMService: !!lazyServices.lazyLLMService,
	});

	return lazyServices;
}

/**
 * Check if lazy loading should be enabled based on environment and configuration
 */
export function shouldEnableLazyLoading(options: EnhancedServiceOptions = {}): boolean {
	if (options.enableLazyLoading !== undefined) {
		return options.enableLazyLoading;
	}

	const lazyConfig = getDefaultLazyConfig();

	return (
		env.ENABLE_LAZY_LOADING === 'true' ||
		Boolean(lazyConfig.skipHeavyServicesOnStartup) ||
		Boolean(lazyConfig.enableEmbeddingLazy) ||
		Boolean(lazyConfig.enableVectorStoreLazy) ||
		Boolean(lazyConfig.enableLLMServiceLazy)
	);
}

/**
 * Utility to get a service from lazy or regular services
 */
export async function getEmbeddingManager(
	services: LazyAgentServices
): Promise<EmbeddingManager | undefined> {
	if (services.lazyEmbeddingManager) {
		try {
			return await services.lazyEmbeddingManager.getInstance();
		} catch (error) {
			logger.warn('Failed to get lazy embedding manager', {
				error: error instanceof Error ? error.message : String(error),
			});
			return undefined;
		}
	}
	return services.embeddingManager;
}

/**
 * Utility to get vector store manager from lazy or regular services
 */
export async function getVectorStoreManager(
	services: LazyAgentServices
): Promise<VectorStoreManager | DualCollectionVectorManager | undefined> {
	if (services.lazyVectorStoreManager) {
		try {
			return await services.lazyVectorStoreManager.getInstance();
		} catch (error) {
			logger.warn('Failed to get lazy vector store manager', {
				error: error instanceof Error ? error.message : String(error),
			});
			return undefined;
		}
	}
	return services.vectorStoreManager;
}

/**
 * Utility to get LLM service from lazy or regular services
 */
export async function getLLMService(services: LazyAgentServices): Promise<ILLMService | undefined> {
	if (services.lazyLLMService) {
		try {
			return await services.lazyLLMService.getInstance();
		} catch (error) {
			logger.warn('Failed to get lazy LLM service', {
				error: error instanceof Error ? error.message : String(error),
			});
			return undefined;
		}
	}
	return services.llmService;
}
