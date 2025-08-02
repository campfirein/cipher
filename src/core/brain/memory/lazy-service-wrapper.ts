/**
 * Lazy Service Wrapper
 *
 * Provides lazy loading wrappers for expensive services that can be deferred
 * until they are actually needed. This integrates with the existing service
 * initializer without breaking the current architecture.
 */

import { logger } from '../../logger/index.js';
import { EmbeddingManager } from '../embedding/index.js';
import { VectorStoreManager, DualCollectionVectorManager } from '../../vector_storage/index.js';
import { ILLMService } from '../llm/index.js';
import { env } from '../../env.js';

/**
 * Configuration for lazy loading services
 */
export interface LazyServiceConfig {
	/**
	 * Enable lazy loading for embedding manager
	 */
	enableEmbeddingLazy?: boolean;

	/**
	 * Enable lazy loading for vector store manager
	 */
	enableVectorStoreLazy?: boolean;

	/**
	 * Enable lazy loading for LLM service
	 */
	enableLLMServiceLazy?: boolean;

	/**
	 * Timeout for lazy initialization (ms)
	 */
	lazyInitTimeout?: number;

	/**
	 * Skip heavy services during initial startup
	 */
	skipHeavyServicesOnStartup?: boolean;
}

/**
 * Default lazy service configuration from environment
 */
export function getDefaultLazyConfig(): LazyServiceConfig {
	return {
		enableEmbeddingLazy: env.ENABLE_LAZY_LOADING === 'true',
		enableVectorStoreLazy: env.ENABLE_LAZY_LOADING === 'true',
		enableLLMServiceLazy: env.ENABLE_LAZY_LOADING === 'true',
		lazyInitTimeout: parseInt(env.LAZY_INIT_TIMEOUT || '10000', 10),
		skipHeavyServicesOnStartup: env.ENABLE_LAZY_LOADING === 'true',
	};
}

/**
 * Lazy wrapper for EmbeddingManager
 */
export class LazyEmbeddingManager {
	private _instance: EmbeddingManager | null = null;
	private _loading: Promise<EmbeddingManager> | null = null;
	private _factory: (() => Promise<EmbeddingManager>) | null = null;
	private _config: LazyServiceConfig;

	constructor(factory: () => Promise<EmbeddingManager>, config: LazyServiceConfig = {}) {
		this._factory = factory;
		this._config = { ...getDefaultLazyConfig(), ...config };
	}

	/**
	 * Get the embedding manager, loading it lazily if needed
	 */
	async getInstance(): Promise<EmbeddingManager> {
		if (this._instance) {
			return this._instance;
		}

		if (this._loading) {
			return this._loading;
		}

		if (!this._factory) {
			throw new Error('LazyEmbeddingManager: No factory provided');
		}

		logger.debug('LazyEmbeddingManager: Loading embedding manager');
		const startTime = Date.now();

		this._loading = Promise.race([
			this._factory(),
			new Promise<never>((_, reject) => {
				setTimeout(() => {
					reject(
						new Error(`LazyEmbeddingManager: Timeout after ${this._config.lazyInitTimeout}ms`)
					);
				}, this._config.lazyInitTimeout || 10000);
			}),
		]);

		try {
			this._instance = await this._loading;
			const loadTime = Date.now() - startTime;
			logger.debug(`LazyEmbeddingManager: Loaded in ${loadTime}ms`);
			return this._instance;
		} catch (error) {
			this._loading = null;
			throw error;
		}
	}

	/**
	 * Check if the service is already loaded
	 */
	isLoaded(): boolean {
		return this._instance !== null;
	}

	/**
	 * Get the instance if already loaded, otherwise return null
	 */
	getLoadedInstance(): EmbeddingManager | null {
		return this._instance;
	}
}

/**
 * Lazy wrapper for VectorStoreManager
 */
export class LazyVectorStoreManager {
	private _instance: VectorStoreManager | DualCollectionVectorManager | null = null;
	private _loading: Promise<VectorStoreManager | DualCollectionVectorManager> | null = null;
	private _factory: (() => Promise<VectorStoreManager | DualCollectionVectorManager>) | null = null;
	private _config: LazyServiceConfig;

	constructor(
		factory: () => Promise<VectorStoreManager | DualCollectionVectorManager>,
		config: LazyServiceConfig = {}
	) {
		this._factory = factory;
		this._config = { ...getDefaultLazyConfig(), ...config };
	}

	/**
	 * Get the vector store manager, loading it lazily if needed
	 */
	async getInstance(): Promise<VectorStoreManager | DualCollectionVectorManager> {
		if (this._instance) {
			return this._instance;
		}

		if (this._loading) {
			return this._loading;
		}

		if (!this._factory) {
			throw new Error('LazyVectorStoreManager: No factory provided');
		}

		logger.debug('LazyVectorStoreManager: Loading vector store manager');
		const startTime = Date.now();

		this._loading = Promise.race([
			this._factory(),
			new Promise<never>((_, reject) => {
				setTimeout(() => {
					reject(
						new Error(`LazyVectorStoreManager: Timeout after ${this._config.lazyInitTimeout}ms`)
					);
				}, this._config.lazyInitTimeout || 10000);
			}),
		]);

		try {
			this._instance = await this._loading;
			const loadTime = Date.now() - startTime;
			logger.debug(`LazyVectorStoreManager: Loaded in ${loadTime}ms`);
			return this._instance;
		} catch (error) {
			this._loading = null;
			throw error;
		}
	}

	/**
	 * Check if the service is already loaded
	 */
	isLoaded(): boolean {
		return this._instance !== null;
	}

	/**
	 * Get the instance if already loaded, otherwise return null
	 */
	getLoadedInstance(): VectorStoreManager | DualCollectionVectorManager | null {
		return this._instance;
	}
}

/**
 * Lazy wrapper for LLM Service
 */
export class LazyLLMService {
	private _instance: ILLMService | null = null;
	private _loading: Promise<ILLMService> | null = null;
	private _factory: (() => Promise<ILLMService>) | null = null;
	private _config: LazyServiceConfig;

	constructor(factory: () => Promise<ILLMService>, config: LazyServiceConfig = {}) {
		this._factory = factory;
		this._config = { ...getDefaultLazyConfig(), ...config };
	}

	/**
	 * Get the LLM service, loading it lazily if needed
	 */
	async getInstance(): Promise<ILLMService> {
		if (this._instance) {
			return this._instance;
		}

		if (this._loading) {
			return this._loading;
		}

		if (!this._factory) {
			throw new Error('LazyLLMService: No factory provided');
		}

		logger.debug('LazyLLMService: Loading LLM service');
		const startTime = Date.now();

		this._loading = Promise.race([
			this._factory(),
			new Promise<never>((_, reject) => {
				setTimeout(() => {
					reject(new Error(`LazyLLMService: Timeout after ${this._config.lazyInitTimeout}ms`));
				}, this._config.lazyInitTimeout || 10000);
			}),
		]);

		try {
			this._instance = await this._loading;
			const loadTime = Date.now() - startTime;
			logger.debug(`LazyLLMService: Loaded in ${loadTime}ms`);
			return this._instance;
		} catch (error) {
			this._loading = null;
			throw error;
		}
	}

	/**
	 * Check if the service is already loaded
	 */
	isLoaded(): boolean {
		return this._instance !== null;
	}

	/**
	 * Get the instance if already loaded, otherwise return null
	 */
	getLoadedInstance(): ILLMService | null {
		return this._instance;
	}
}

/**
 * Enhanced agent services with lazy loading support
 */
export interface LazyAgentServices {
	[key: string]: any;
	// Always loaded core services
	mcpManager: any;
	promptManager: any;
	stateManager: any;
	sessionManager: any;
	internalToolManager: any;
	unifiedToolManager: any;
	eventManager: any;

	// Original services for compatibility (may be undefined if lazy)
	embeddingManager?: EmbeddingManager;
	vectorStoreManager?: VectorStoreManager | DualCollectionVectorManager;
	llmService?: ILLMService;
	knowledgeGraphManager?: any;

	// Lazy service wrappers
	lazyEmbeddingManager?: LazyEmbeddingManager;
	lazyVectorStoreManager?: LazyVectorStoreManager;
	lazyLLMService?: LazyLLMService;

	// Configuration
	lazyConfig?: LazyServiceConfig;
}
