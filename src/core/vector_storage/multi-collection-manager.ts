/**
 * Multi Collection Vector Manager
 *
 * Manages multiple separate vector collections for knowledge, reflection, and workspace memory.
 * Built on top of the existing VectorStoreManager infrastructure.
 */

import { VectorStoreManager } from './manager.js';
import { VectorStore } from './backend/vector-store.js';
import type { VectorStoreConfig } from './types.js';
import { Logger, createLogger } from '../logger/index.js';
import { env } from '../env.js';
import { EventManager } from '../events/event-manager.js';

/**
 * Collection type identifier
 */
export type CollectionType = 'knowledge' | 'reflection' | 'workspace';

/**
 * Information about all collections
 */
export interface MultiCollectionInfo {
	knowledge: {
		connected: boolean;
		collectionName: string;
		manager: VectorStoreManager;
	};
	reflection: {
		connected: boolean;
		collectionName: string;
		manager: VectorStoreManager;
		enabled: boolean;
	};
	workspace: {
		connected: boolean;
		collectionName: string;
		manager: VectorStoreManager;
		enabled: boolean;
	};
	overallConnected: boolean;
}

/**
 * Multi Collection Vector Manager
 *
 * Manages separate vector collections for knowledge, reflection, and workspace memory.
 * Uses multiple VectorStoreManager instances under the hood.
 *
 * @example
 * ```typescript
 * const multiManager = new MultiCollectionVectorManager(baseConfig);
 * await multiManager.connect();
 *
 * // Get knowledge store
 * const knowledgeStore = multiManager.getStore('knowledge');
 *
 * // Get reflection store (if enabled)
 * const reflectionStore = multiManager.getStore('reflection');
 *
 * // Get workspace store (if enabled)
 * const workspaceStore = multiManager.getStore('workspace');
 * ```
 */
export class MultiCollectionVectorManager {
	private readonly knowledgeManager: VectorStoreManager;
	private readonly reflectionManager: VectorStoreManager | null;
	private readonly workspaceManager: VectorStoreManager | null;
	private readonly logger: Logger;
	private readonly reflectionEnabled: boolean;
	private readonly workspaceEnabled: boolean;
	private eventManager?: EventManager;

	constructor(baseConfig: VectorStoreConfig) {
		this.logger = createLogger({
			level: env.CIPHER_LOG_LEVEL || 'info',
		});

		// Check if reflection memory is enabled
		this.reflectionEnabled = !!(
			env.REFLECTION_VECTOR_STORE_COLLECTION && env.REFLECTION_VECTOR_STORE_COLLECTION.trim()
		);

		// Check if workspace memory is enabled
		this.workspaceEnabled = !!(
			env.USE_WORKSPACE_MEMORY &&
			env.WORKSPACE_VECTOR_STORE_COLLECTION &&
			env.WORKSPACE_VECTOR_STORE_COLLECTION.trim()
		);

		// Create knowledge manager with original collection name
		this.knowledgeManager = new VectorStoreManager(baseConfig);

		// Create reflection manager only if reflection collection name is set
		if (this.reflectionEnabled) {
			const reflectionConfig: VectorStoreConfig = {
				...baseConfig,
				collectionName: env.REFLECTION_VECTOR_STORE_COLLECTION,
			};
			this.reflectionManager = new VectorStoreManager(reflectionConfig);
		} else {
			this.reflectionManager = null;
		}

		// Create workspace manager only if workspace memory is enabled
		if (this.workspaceEnabled) {
			// Create workspace config with proper type handling
			const workspaceConfig = {
				...baseConfig,
				// Override collection name and dimension
				collectionName: env.WORKSPACE_VECTOR_STORE_COLLECTION,
				dimension: env.WORKSPACE_VECTOR_STORE_DIMENSION || baseConfig.dimension,
			} as VectorStoreConfig;

			// Override type if specified
			if (env.WORKSPACE_VECTOR_STORE_TYPE) {
				workspaceConfig.type = env.WORKSPACE_VECTOR_STORE_TYPE;
			}

			// Only add type-specific properties if they exist in the base config and environment
			if ('host' in baseConfig && env.WORKSPACE_VECTOR_STORE_HOST) {
				(workspaceConfig as any).host = env.WORKSPACE_VECTOR_STORE_HOST;
			}
			if ('port' in baseConfig && env.WORKSPACE_VECTOR_STORE_PORT) {
				(workspaceConfig as any).port = env.WORKSPACE_VECTOR_STORE_PORT;
			}
			if ('url' in baseConfig && env.WORKSPACE_VECTOR_STORE_URL) {
				(workspaceConfig as any).url = env.WORKSPACE_VECTOR_STORE_URL;
			}
			if ('apiKey' in baseConfig && env.WORKSPACE_VECTOR_STORE_API_KEY) {
				(workspaceConfig as any).apiKey = env.WORKSPACE_VECTOR_STORE_API_KEY;
			}
			if ('username' in baseConfig && env.WORKSPACE_VECTOR_STORE_USERNAME) {
				(workspaceConfig as any).username = env.WORKSPACE_VECTOR_STORE_USERNAME;
			}
			if ('password' in baseConfig && env.WORKSPACE_VECTOR_STORE_PASSWORD) {
				(workspaceConfig as any).password = env.WORKSPACE_VECTOR_STORE_PASSWORD;
			}
			if ('distance' in baseConfig && env.WORKSPACE_VECTOR_STORE_DISTANCE) {
				(workspaceConfig as any).distance = env.WORKSPACE_VECTOR_STORE_DISTANCE;
			}
			if ('onDisk' in baseConfig && env.WORKSPACE_VECTOR_STORE_ON_DISK !== undefined) {
				(workspaceConfig as any).onDisk = env.WORKSPACE_VECTOR_STORE_ON_DISK;
			}
			if ('maxVectors' in baseConfig && env.WORKSPACE_VECTOR_STORE_MAX_VECTORS) {
				(workspaceConfig as any).maxVectors = env.WORKSPACE_VECTOR_STORE_MAX_VECTORS;
			}
			this.workspaceManager = new VectorStoreManager(workspaceConfig);

			this.logger.info('MultiCollectionVectorManager: Initialized with multiple collections', {
				backend: baseConfig.type,
				knowledgeCollection: baseConfig.collectionName,
				reflectionCollection: this.reflectionEnabled
					? env.REFLECTION_VECTOR_STORE_COLLECTION
					: 'disabled',
				workspaceCollection: env.WORKSPACE_VECTOR_STORE_COLLECTION,
				dimension: baseConfig.dimension,
			});
		} else {
			this.workspaceManager = null;

			this.logger.info('MultiCollectionVectorManager: Initialized without workspace memory', {
				backend: baseConfig.type,
				knowledgeCollection: baseConfig.collectionName,
				reflectionCollection: this.reflectionEnabled
					? env.REFLECTION_VECTOR_STORE_COLLECTION
					: 'disabled',
				workspaceCollection: 'disabled',
				dimension: baseConfig.dimension,
			});
		}
	}

	/**
	 * Set event manager for event-aware operations
	 */
	setEventManager(eventManager: EventManager): void {
		this.eventManager = eventManager;
		this.knowledgeManager.setEventManager(eventManager);
		if (this.reflectionManager) {
			this.reflectionManager.setEventManager(eventManager);
		}
		if (this.workspaceManager) {
			this.workspaceManager.setEventManager(eventManager);
		}
	}

	/**
	 * Connect to all enabled vector stores
	 */
	async connect(): Promise<boolean> {
		const promises: Promise<VectorStore>[] = [];

		// Always connect knowledge manager
		promises.push(this.knowledgeManager.connect());

		// Connect reflection manager if enabled
		if (this.reflectionManager) {
			promises.push(this.reflectionManager.connect());
		}

		// Connect workspace manager if enabled
		if (this.workspaceManager) {
			promises.push(this.workspaceManager.connect());
		}

		try {
			const results = await Promise.all(promises);

			// Check if at least the knowledge manager connected successfully
			const knowledgeConnected = !!results[0];

			if (!knowledgeConnected) {
				this.logger.error('MultiCollectionVectorManager: Failed to connect knowledge manager');
				return false;
			}

			this.logger.info('MultiCollectionVectorManager: Connection completed', {
				knowledge: knowledgeConnected,
				reflection: this.reflectionEnabled ? !!results[1] : 'disabled',
				workspace: this.workspaceEnabled ? !!results[results.length - 1] : 'disabled',
			});

			return true;
		} catch (error) {
			this.logger.error('MultiCollectionVectorManager: Connection failed', {
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	}

	/**
	 * Disconnect from all vector stores
	 */
	async disconnect(): Promise<void> {
		const promises: Promise<void>[] = [];

		promises.push(this.knowledgeManager.disconnect());

		if (this.reflectionManager) {
			promises.push(this.reflectionManager.disconnect());
		}

		if (this.workspaceManager) {
			promises.push(this.workspaceManager.disconnect());
		}

		await Promise.all(promises);
	}

	/**
	 * Get vector store by collection type
	 */
	getStore(type: CollectionType): VectorStore | null {
		switch (type) {
			case 'knowledge':
				return this.knowledgeManager.getStore();
			case 'reflection':
				if (!this.reflectionEnabled || !this.reflectionManager) {
					this.logger.debug('MultiCollectionVectorManager: Reflection memory is disabled');
					return null;
				}
				return this.reflectionManager.getStore();
			case 'workspace':
				if (!this.workspaceEnabled || !this.workspaceManager) {
					this.logger.debug('MultiCollectionVectorManager: Workspace memory is disabled');
					return null;
				}
				return this.workspaceManager.getStore();
			default:
				throw new Error(`Unknown collection type: ${type}`);
		}
	}

	/**
	 * Get vector store by named collection (for backward compatibility)
	 */
	getNamedStore(collectionName: string): VectorStore | null {
		// Map collection names to types
		if (collectionName === env.WORKSPACE_VECTOR_STORE_COLLECTION) {
			return this.getStore('workspace');
		}
		if (collectionName === env.REFLECTION_VECTOR_STORE_COLLECTION) {
			return this.getStore('reflection');
		}
		// Default to knowledge store for other collection names
		return this.getStore('knowledge');
	}

	/**
	 * Get an event-aware vector store by collection type for a specific session
	 */
	getEventAwareStore(type: CollectionType, sessionId: string): VectorStore | null {
		switch (type) {
			case 'knowledge':
				return this.knowledgeManager.getEventAwareStore(sessionId);
			case 'reflection':
				if (!this.reflectionEnabled || !this.reflectionManager) {
					this.logger.debug('MultiCollectionVectorManager: Reflection memory is disabled');
					return null;
				}
				return this.reflectionManager.getEventAwareStore(sessionId);
			case 'workspace':
				if (!this.workspaceEnabled || !this.workspaceManager) {
					this.logger.debug('MultiCollectionVectorManager: Workspace memory is disabled');
					return null;
				}
				return this.workspaceManager.getEventAwareStore(sessionId);
			default:
				throw new Error(`Unknown collection type: ${type}`);
		}
	}

	/**
	 * Health check for all collections
	 */
	async healthCheck(): Promise<{
		knowledge: boolean;
		reflection: boolean;
		workspace: boolean;
		overall: boolean;
	}> {
		const knowledgeHealthy = (await this.knowledgeManager.healthCheck()).overall;

		let reflectionHealthy = true;
		if (this.reflectionEnabled && this.reflectionManager) {
			reflectionHealthy = (await this.reflectionManager.healthCheck()).overall;
		}

		let workspaceHealthy = true;
		if (this.workspaceEnabled && this.workspaceManager) {
			workspaceHealthy = (await this.workspaceManager.healthCheck()).overall;
		}

		return {
			knowledge: knowledgeHealthy,
			reflection: reflectionHealthy,
			workspace: workspaceHealthy,
			overall: knowledgeHealthy && reflectionHealthy && workspaceHealthy,
		};
	}

	/**
	 * Get vector store manager by collection type
	 */
	getManager(type: CollectionType): VectorStoreManager | null {
		switch (type) {
			case 'knowledge':
				return this.knowledgeManager;
			case 'reflection':
				return this.reflectionManager;
			case 'workspace':
				return this.workspaceManager;
			default:
				throw new Error(`Unknown collection type: ${type}`);
		}
	}

	/**
	 * Get information about all collections
	 */
	getInfo(): MultiCollectionInfo {
		return {
			knowledge: {
				connected: this.knowledgeManager.isConnected(),
				collectionName: this.knowledgeManager.getInfo().backend.collectionName,
				manager: this.knowledgeManager,
			},
			reflection: {
				connected: this.reflectionManager?.isConnected() ?? false,
				collectionName: env.REFLECTION_VECTOR_STORE_COLLECTION || '',
				manager: this.reflectionManager!,
				enabled: this.reflectionEnabled,
			},
			workspace: {
				connected: this.workspaceManager?.isConnected() ?? false,
				collectionName: env.WORKSPACE_VECTOR_STORE_COLLECTION || '',
				manager: this.workspaceManager!,
				enabled: this.workspaceEnabled,
			},
			overallConnected:
				this.knowledgeManager.isConnected() &&
				(!this.reflectionEnabled || this.reflectionManager?.isConnected() === true) &&
				(!this.workspaceEnabled || this.workspaceManager?.isConnected() === true),
		};
	}

	/**
	 * Check if any collection is connected
	 */
	isConnected(): boolean {
		return this.knowledgeManager.isConnected();
	}
}
