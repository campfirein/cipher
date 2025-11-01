/**
 * Knowledge Graph Manager
 *
 * Manages the lifecycle of knowledge graph backends and provides a unified interface
 * for knowledge graph operations. Handles connection management, health checks,
 * fallback scenarios, and statistics tracking.
 *
 * @module knowledge_graph/manager
 */

import { Logger, createLogger } from '../logger/logger.js';
import type { KnowledgeGraph } from './backend/knowledge-graph.js';
import { KnowledgeGraphConnectionError } from './backend/types.js';
import type { KnowledgeGraphConfig } from './config.js';
import { BACKEND_TYPES, DEFAULTS, ERROR_MESSAGES, LOG_PREFIXES, TIMEOUTS } from './constants.js';

/**
 * Health check result for knowledge graph
 */
export interface HealthCheckResult {
	backend: boolean;
	overall: boolean;
	details?: {
		backend?: { status: string; latency?: number; error?: string };
	};
}

/**
 * Knowledge graph information for monitoring
 */
export interface KnowledgeGraphInfo {
	connected: boolean;
	backend: {
		type: string;
		connected: boolean;
		fallback: boolean;
	};
	connectionAttempts: number;
	lastError: string | undefined;
}

/**
 * Statistics for knowledge graph operations
 */
export interface KnowledgeGraphStats {
	totalNodes: number;
	totalEdges: number;
	totalQueries: number;
	totalOperations: number;
	averageQueryTime: number;
	lastOperationTime: number;
	connectionUptime: number;
}

/**
 * Knowledge Graph Manager
 *
 * Provides a high-level interface for managing knowledge graph operations.
 * Handles backend lifecycle, connection management, and error recovery.
 *
 * @example
 * ```typescript
 * const manager = new KnowledgeGraphManager(config);
 * await manager.connect();
 *
 * const graph = manager.getGraph();
 * await graph.addNode({
 *   id: 'node1',
 *   labels: ['Function'],
 *   properties: { name: 'myFunction' }
 * });
 * ```
 */
export class KnowledgeGraphManager {
	private graph: KnowledgeGraph | undefined;
	private connected = false;
	private readonly config: KnowledgeGraphConfig;
	private readonly logger: Logger;

	// Connection tracking
	private connectionAttempts = 0;
	private lastConnectionError?: Error;
	private connectionStartTime = 0;

	// Backend metadata
	private backendMetadata = {
		type: 'unknown',
		connected: false,
		fallback: false,
		lastHealthCheck: 0,
	};

	// Statistics
	private stats: KnowledgeGraphStats = {
		totalNodes: 0,
		totalEdges: 0,
		totalQueries: 0,
		totalOperations: 0,
		averageQueryTime: 0,
		lastOperationTime: 0,
		connectionUptime: 0,
	};

	// Module loading cache
	private static neo4jModule?: any;
	private static inMemoryModule?: any;

	// Health check configuration
	private readonly healthCheckInterval = TIMEOUTS.HEALTH_CHECK;
	private healthCheckTimer?: NodeJS.Timeout;

	/**
	 * Creates a new Knowledge Graph Manager
	 *
	 * @param config - Knowledge graph configuration
	 */
	constructor(config: KnowledgeGraphConfig) {
		this.config = config;
		this.logger = createLogger({
			level: 'debug',
		});

		this.logger.debug(`${LOG_PREFIXES.MANAGER} Initialized with backend type: ${config.type}`);
	}

	/**
	 * Get the current configuration
	 */
	public getConfig(): Readonly<KnowledgeGraphConfig> {
		return this.config;
	}

	/**
	 * Get manager information for monitoring
	 */
	public getInfo(): KnowledgeGraphInfo {
		return {
			connected: this.connected,
			backend: {
				type: this.backendMetadata.type,
				connected: this.backendMetadata.connected,
				fallback: this.backendMetadata.fallback,
			},
			connectionAttempts: this.connectionAttempts,
			lastError: this.lastConnectionError?.message,
		};
	}

	/**
	 * Get the knowledge graph instance
	 */
	public getGraph(): KnowledgeGraph | null {
		if (!this.connected || !this.graph) {
			return null;
		}
		return this.graph;
	}

	/**
	 * Get the current backend type
	 *
	 * Returns the type of the currently connected backend, or the last known type
	 * if disconnected. When connected, this method delegates to the backend instance
	 * (source of truth). When disconnected, it returns cached metadata or 'unknown'.
	 *
	 * This method is useful for conditional logic based on backend capabilities,
	 * particularly for determining if advanced features like Cypher queries
	 * (Neo4j-specific) are available.
	 *
	 * @returns Backend type identifier ('neo4j', 'in-memory', or 'unknown')
	 *
	 * @example
	 * ```typescript
	 * // Check backend type before executing queries
	 * const manager = new KnowledgeGraphManager(config);
	 * await manager.connect();
	 *
	 * const backendType = manager.getBackendType();
	 * if (backendType === 'neo4j') {
	 *   // Execute Cypher queries
	 *   const graph = manager.getGraph();
	 *   await graph.query({
	 *     type: 'cypher',
	 *     query: 'MATCH (n:Function)-[r:CALLS]->(m) RETURN n, r, m'
	 *   });
	 * } else {
	 *   // Use structured queries for in-memory
	 *   await graph.query({
	 *     type: 'node',
	 *     pattern: { labels: ['Function'] }
	 *   });
	 * }
	 * ```
	 */
	public getBackendType(): string {
		// When connected: delegate to the backend instance (source of truth)
		if (this.graph) {
			return this.graph.getBackendType();
		}
		// When disconnected: return cached metadata or safe default
		return this.backendMetadata.type || 'unknown';
	}

	/**
	 * Check if the manager is connected and ready
	 */
	public isConnected(): boolean {
		return this.connected && this.graph?.isConnected() === true;
	}

	/**
	 * Connect to the knowledge graph backend
	 */
	public async connect(): Promise<KnowledgeGraph> {
		if (this.connected && this.graph) {
			this.logger.debug(`${LOG_PREFIXES.MANAGER} Already connected`);
			return this.graph;
		}

		this.connectionAttempts++;
		this.connectionStartTime = Date.now();

		this.logger.debug(`${LOG_PREFIXES.MANAGER} Starting connect() - config.type: ${this.config.type}`);
		this.logger.debug(`${LOG_PREFIXES.MANAGER} Config:`, JSON.stringify(this.config, null, 2));

		try {
			this.logger.info(`${LOG_PREFIXES.MANAGER} Connecting to ${this.config.type} backend...`);
			this.logger.debug(`${LOG_PREFIXES.MANAGER} About to call createBackend()`);

			// Create backend instance
			this.graph = await this.createBackend();
			this.logger.debug(`${LOG_PREFIXES.MANAGER} createBackend() returned, backend type: ${this.graph.getBackendType()}`);

			// Connect to backend
			this.logger.debug(`${LOG_PREFIXES.MANAGER} About to call graph.connect()`);

			await this.graph.connect();

			// Verify connection
			if (!this.graph.isConnected()) {
				throw new KnowledgeGraphConnectionError(
					'Backend reports as not connected after connection attempt',
					this.config.type
				);
			}

			// Update metadata
			this.backendMetadata = {
				type: this.graph.getBackendType(),
				connected: true,
				fallback: false,
				lastHealthCheck: Date.now(),
			};

			this.connected = true;
			delete this.lastConnectionError;

			// Start health monitoring
			this.startHealthMonitoring();

			// Load initial statistics
			await this.updateStatistics();

			this.logger.info(
				`${LOG_PREFIXES.MANAGER} Connected successfully to ${this.backendMetadata.type} backend`
			);

			return this.graph;
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MANAGER} ERROR in connect():`, error);
			this.lastConnectionError = error as Error;
			this.backendMetadata.connected = false;

			this.logger.error(`${LOG_PREFIXES.MANAGER} Connection failed:`, error);

			// Try fallback to in-memory backend if configured
			if (this.config.type !== BACKEND_TYPES.IN_MEMORY) {
				this.logger.warn(`${LOG_PREFIXES.MANAGER} config.type=${this.config.type}, attempting fallback to in-memory`);
				this.logger.warn(`${LOG_PREFIXES.MANAGER} Attempting fallback to in-memory backend...`);

				try {
					this.logger.debug(`${LOG_PREFIXES.MANAGER} Calling createInMemoryFallback()`);
					this.graph = await this.createInMemoryFallback();
					this.logger.debug(`${LOG_PREFIXES.MANAGER} createInMemoryFallback() succeeded`);

					await this.graph.connect();

					this.backendMetadata = {
						type: this.graph.getBackendType(),
						connected: true,
						fallback: true,
						lastHealthCheck: Date.now(),
					};

					this.connected = true;
					this.startHealthMonitoring();

					this.logger.warn(`${LOG_PREFIXES.MANAGER} Connected to fallback in-memory backend`);
					return this.graph;
				} catch (fallbackError) {
					this.logger.error(
						`${LOG_PREFIXES.MANAGER} Fallback connection also failed:`,
						fallbackError
					);
				}
			}

			throw error;
		}
	}

	/**
	 * Disconnect from the knowledge graph backend
	 */
	public async disconnect(): Promise<void> {
		if (!this.connected || !this.graph) {
			this.logger.debug(`${LOG_PREFIXES.MANAGER} Already disconnected`);
			return;
		}

		try {
			// Stop health monitoring
			this.stopHealthMonitoring();

			// Update uptime
			if (this.connectionStartTime > 0) {
				this.stats.connectionUptime = Date.now() - this.connectionStartTime;
			}

			// Disconnect from backend
			await this.graph.disconnect();

			// Reset state
			this.graph = undefined;
			this.connected = false;
			this.backendMetadata.connected = false;

			this.logger.info(`${LOG_PREFIXES.MANAGER} Disconnected successfully`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MANAGER} Error during disconnect:`, error);
			throw error;
		}
	}

	/**
	 * Perform health check on the knowledge graph backend
	 */
	public async healthCheck(): Promise<HealthCheckResult> {
		const startTime = Date.now();
		let backendHealth = false;
		let backendDetails: any = {};

		try {
			if (this.graph && this.connected) {
				// Test basic connectivity
				backendHealth = this.graph.isConnected();

				if (backendHealth) {
					// Test basic operation
					await this.graph.getStatistics();
					backendDetails = {
						status: 'healthy',
						latency: Date.now() - startTime,
					};
				} else {
					backendDetails = {
						status: 'disconnected',
						error: 'Backend reports as not connected',
					};
				}
			} else {
				backendDetails = {
					status: 'not_initialized',
					error: 'Knowledge graph not initialized',
				};
			}
		} catch (error) {
			backendHealth = false;
			backendDetails = {
				status: 'error',
				error: (error as Error).message,
				latency: Date.now() - startTime,
			};
		}

		// Update last health check time
		this.backendMetadata.lastHealthCheck = Date.now();

		const result: HealthCheckResult = {
			backend: backendHealth,
			overall: backendHealth,
			details: {
				backend: backendDetails,
			},
		};

		// this.logger.debug(`${LOG_PREFIXES.MANAGER} Health check completed:`, result);

		return result;
	}

	/**
	 * Get current statistics
	 */
	public getStats(): KnowledgeGraphStats {
		return { ...this.stats };
	}

	/**
	 * Reset statistics
	 */
	public resetStats(): void {
		this.stats = {
			totalNodes: 0,
			totalEdges: 0,
			totalQueries: 0,
			totalOperations: 0,
			averageQueryTime: 0,
			lastOperationTime: 0,
			connectionUptime: this.connectionStartTime > 0 ? Date.now() - this.connectionStartTime : 0,
		};

		this.logger.debug(`${LOG_PREFIXES.MANAGER} Statistics reset`);
	}

	/**
	 * Execute a knowledge graph operation with statistics tracking
	 */
	public async executeOperation<T>(
		operation: (graph: KnowledgeGraph) => Promise<T>,
		operationType: 'read' | 'write' | 'query' = 'read'
	): Promise<T> {
		if (!this.graph || !this.connected) {
			throw new KnowledgeGraphConnectionError(
				ERROR_MESSAGES.NOT_CONNECTED,
				this.backendMetadata.type
			);
		}

		const startTime = Date.now();

		try {
			const result = await operation(this.graph);

			// Update statistics
			const executionTime = Date.now() - startTime;
			this.updateOperationStats(operationType, executionTime, true);

			return result;
		} catch (error) {
			// Update error statistics
			const executionTime = Date.now() - startTime;
			this.updateOperationStats(operationType, executionTime, false);

			this.logger.error(`${LOG_PREFIXES.MANAGER} Operation failed:`, error);
			throw error;
		}
	}

	/**
	 * Get backend-specific debug information
	 */
	public getDebugInfo(): Record<string, any> {
		return {
			config: this.config,
			backendMetadata: this.backendMetadata,
			connectionAttempts: this.connectionAttempts,
			lastConnectionError: this.lastConnectionError?.message,
			stats: this.stats,
			connected: this.connected,
			healthMonitoring: !!this.healthCheckTimer,
		};
	}

	// Private methods

	private async createBackend(): Promise<KnowledgeGraph> {
		switch (this.config.type) {
			case BACKEND_TYPES.NEO4J:
				return this.createNeo4jBackend();
			case BACKEND_TYPES.IN_MEMORY:
				return this.createInMemoryBackend();
			default:
				throw new KnowledgeGraphConnectionError(
					`Unsupported backend type: ${(this.config as any).type}`,
					(this.config as any).type
				);
		}
	}

	private async createNeo4jBackend(): Promise<KnowledgeGraph> {
		try {
			// Lazy load Neo4j module
			if (!KnowledgeGraphManager.neo4jModule) {
				this.logger.debug(`${LOG_PREFIXES.MANAGER} Loading Neo4j backend module...`);
				const module = await import('./backend/neo4j.js');
				KnowledgeGraphManager.neo4jModule = module;
			}

			const { Neo4jBackend } = KnowledgeGraphManager.neo4jModule;
			return new Neo4jBackend(this.config);
		} catch (error) {
			throw new KnowledgeGraphConnectionError(
				`Failed to create Neo4j backend: ${(error as Error).message}`,
				BACKEND_TYPES.NEO4J,
				error as Error
			);
		}
	}

	private async createInMemoryBackend(): Promise<KnowledgeGraph> {
		try {
			// Lazy load in-memory module
			if (!KnowledgeGraphManager.inMemoryModule) {
				this.logger.debug(`${LOG_PREFIXES.MANAGER} Loading in-memory backend module...`);
				const module = await import('./backend/in-memory.js');
				KnowledgeGraphManager.inMemoryModule = module;
			}

			const { InMemoryBackend } = KnowledgeGraphManager.inMemoryModule;
			return new InMemoryBackend(this.config);
		} catch (error) {
			throw new KnowledgeGraphConnectionError(
				`Failed to create in-memory backend: ${(error as Error).message}`,
				BACKEND_TYPES.IN_MEMORY,
				error as Error
			);
		}
	}

	private async createInMemoryFallback(): Promise<KnowledgeGraph> {
		// Create fallback in-memory configuration
		const fallbackConfig = {
			...this.config,
			type: BACKEND_TYPES.IN_MEMORY,
			maxNodes: DEFAULTS.MAX_NODES,
			maxEdges: DEFAULTS.MAX_EDGES,
			enableIndexing: true,
			enableGarbageCollection: false,
		};

		if (!KnowledgeGraphManager.inMemoryModule) {
			const module = await import('./backend/in-memory.js');
			KnowledgeGraphManager.inMemoryModule = module;
		}

		const { InMemoryBackend } = KnowledgeGraphManager.inMemoryModule;
		return new InMemoryBackend(fallbackConfig);
	}

	private async updateStatistics(): Promise<void> {
		if (!this.graph || !this.connected) {
			return;
		}

		try {
			const graphStats = await this.graph.getStatistics();
			this.stats.totalNodes = graphStats.nodeCount;
			this.stats.totalEdges = graphStats.edgeCount;

			// Update connection uptime
			if (this.connectionStartTime > 0) {
				this.stats.connectionUptime = Date.now() - this.connectionStartTime;
			}
		} catch (error) {
			this.logger.warn(`${LOG_PREFIXES.MANAGER} Failed to update statistics:`, error);
		}
	}

	private updateOperationStats(
		operationType: 'read' | 'write' | 'query',
		executionTime: number,
		success: boolean
	): void {
		this.stats.totalOperations++;
		this.stats.lastOperationTime = Date.now();

		if (operationType === 'query') {
			this.stats.totalQueries++;

			// Update average query time
			const totalQueryTime = this.stats.averageQueryTime * (this.stats.totalQueries - 1);
			this.stats.averageQueryTime = (totalQueryTime + executionTime) / this.stats.totalQueries;
		}

		if (success) {
			this.logger.debug(
				`${LOG_PREFIXES.MANAGER} ${operationType} operation completed in ${executionTime}ms`
			);
		} else {
			this.logger.warn(
				`${LOG_PREFIXES.MANAGER} ${operationType} operation failed after ${executionTime}ms`
			);
		}
	}

	private startHealthMonitoring(): void {
		if (this.healthCheckTimer) {
			this.stopHealthMonitoring();
		}

		this.healthCheckTimer = setInterval(async () => {
			try {
				await this.healthCheck();
			} catch (error) {
				this.logger.warn(`${LOG_PREFIXES.MANAGER} Health check failed:`, error);
			}
		}, this.healthCheckInterval);

		this.logger.debug(
			`${LOG_PREFIXES.MANAGER} Started health monitoring (interval: ${this.healthCheckInterval}ms)`
		);
	}

	private stopHealthMonitoring(): void {
		if (this.healthCheckTimer) {
			clearInterval(this.healthCheckTimer);
			delete this.healthCheckTimer;
			this.logger.debug(`${LOG_PREFIXES.MANAGER} Stopped health monitoring`);
		}
	}

	/**
	 * Create a new manager instance from environment configuration
	 */
	public static async createFromEnv(): Promise<KnowledgeGraphManager | null> {
		const { parseKnowledgeGraphConfigFromEnv } = await import('./config.js');
		const config = parseKnowledgeGraphConfigFromEnv();

		if (!config) {
			return null;
		}

		return new KnowledgeGraphManager(config);
	}

	/**
	 * Create a default in-memory manager for testing/development
	 */
	public static createDefault(): KnowledgeGraphManager {
		const config = {
			type: BACKEND_TYPES.IN_MEMORY,
			maxNodes: DEFAULTS.MAX_NODES,
			maxEdges: DEFAULTS.MAX_EDGES,
			enableIndexing: true,
			enableGarbageCollection: false,
			enableAutoIndexing: true,
			enableMetrics: false,
			enableQueryCache: false,
			queryCacheTTL: DEFAULTS.QUERY_CACHE_TTL,
			enableSchemaValidation: true,
			defaultBatchSize: DEFAULTS.BATCH_SIZE,
			timeout: DEFAULTS.CONNECTION_TIMEOUT,
			maxRetries: DEFAULTS.MAX_RETRIES,
			enablePooling: true,
			poolSize: DEFAULTS.POOL_SIZE,
		};

		return new KnowledgeGraphManager(config);
	}
}
