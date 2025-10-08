/**
 * Knowledge Graph Factory
 *
 * Factory functions for creating and initializing knowledge graph instances.
 * Provides a simplified API for common knowledge graph setup patterns.
 *
 * @module knowledge_graph/factory
 */

import { KnowledgeGraphManager } from './manager.js';
import type { KnowledgeGraph } from './backend/knowledge-graph.js';
import type { KnowledgeGraphConfig } from './config.js';
import { parseKnowledgeGraphConfigFromEnv } from './config.js';
import { createLogger } from '../logger/logger.js';
import { LOG_PREFIXES, BACKEND_TYPES, DEFAULTS } from './constants.js';
import { env } from '../env.js';

/**
 * Factory result containing both the manager and knowledge graph
 */
export interface KnowledgeGraphFactory {
	/** The knowledge graph manager instance for lifecycle control */
	manager: KnowledgeGraphManager;
	/** The connected knowledge graph ready for use */
	graph: KnowledgeGraph;
}

/**
 * Creates and connects knowledge graph backend
 *
 * This is the primary factory function for initializing the knowledge graph system.
 * It creates a KnowledgeGraphManager, connects to the configured backend, and
 * returns both the manager and the connected knowledge graph.
 *
 * @param config - Knowledge graph configuration
 * @returns Promise resolving to manager and connected knowledge graph
 * @throws {KnowledgeGraphConnectionError} If connection fails and no fallback is available
 *
 * @example
 * ```typescript
 * // Basic usage with Neo4j
 * const { manager, graph } = await createKnowledgeGraph({
 *   type: 'neo4j',
 *   host: 'localhost',
 *   port: 7687,
 *   username: 'neo4j',
 *   password: 'password',
 *   database: 'knowledge'
 * });
 *
 * // Use the knowledge graph
 * await graph.addNode({
 *   id: 'entity1',
 *   labels: ['Person'],
 *   properties: { name: 'John Doe' }
 * });
 *
 * // Cleanup when done
 * await manager.disconnect();
 * ```
 *
 * @example
 * ```typescript
 * // Development configuration with in-memory
 * const { manager, graph } = await createKnowledgeGraph({
 *   type: 'in-memory',
 *   maxNodes: 1000,
 *   maxEdges: 5000,
 *   enableIndexing: true
 * });
 * ```
 */
export async function createKnowledgeGraph(
	config: KnowledgeGraphConfig
): Promise<KnowledgeGraphFactory> {
	const logger = createLogger({ level: env.CIPHER_LOG_LEVEL });

	logger.debug(`${LOG_PREFIXES.FACTORY} Creating knowledge graph system`, {
		type: config.type,
		enableAutoIndexing: config.enableAutoIndexing,
		enableMetrics: config.enableMetrics,
	});

	// Create manager
	const manager = new KnowledgeGraphManager(config);

	try {
		// Connect to backend
		await manager.connect();

		const graph = manager.getGraph();

		if (!graph) {
			throw new Error('Failed to get knowledge graph instance after connection');
		}

		logger.info(`${LOG_PREFIXES.FACTORY} Knowledge graph system created successfully`, {
			type: manager.getInfo().backend.type,
			connected: manager.isConnected(),
			fallback: manager.getInfo().backend.fallback,
		});

		return { manager, graph };
	} catch (error) {
		// If connection fails, ensure cleanup
		await manager.disconnect().catch(() => {
			// Ignore disconnect errors during cleanup
		});

		logger.error(`${LOG_PREFIXES.FACTORY} Failed to create knowledge graph system`, {
			error: error instanceof Error ? error.message : String(error),
		});

		throw error;
	}
}

/**
 * Creates knowledge graph with default configuration
 *
 * Convenience function that creates knowledge graph with in-memory backend.
 * Useful for testing or development environments.
 *
 * @param maxNodes - Optional maximum nodes (default: 10000)
 * @param maxEdges - Optional maximum edges (default: 50000)
 * @returns Promise resolving to manager and connected knowledge graph
 *
 * @example
 * ```typescript
 * const { manager, graph } = await createDefaultKnowledgeGraph();
 * // Uses in-memory backend with default settings
 *
 * const { manager, graph } = await createDefaultKnowledgeGraph(1000, 5000);
 * // Uses in-memory backend with custom limits
 * ```
 */
export async function createDefaultKnowledgeGraph(
	maxNodes: number = DEFAULTS.MAX_NODES,
	maxEdges: number = DEFAULTS.MAX_EDGES
): Promise<KnowledgeGraphFactory> {
	return createKnowledgeGraph({
		type: BACKEND_TYPES.IN_MEMORY,
		timeout: 30000,
		maxRetries: 3,
		enablePooling: true,
		poolSize: 10,
		maxNodes,
		maxEdges,
		enableIndexing: true,
		enableGarbageCollection: false,
		enableAutoIndexing: true,
		enableMetrics: false,
		enableQueryCache: true,
		queryCacheTTL: 300000,
		enableSchemaValidation: true,
		defaultBatchSize: 1000,
	});
}

/**
 * Creates knowledge graph from environment variables
 *
 * Reads knowledge graph configuration from environment variables and creates
 * the knowledge graph system. Returns null if knowledge graph is disabled.
 *
 * Environment variables:
 * - KNOWLEDGE_GRAPH_ENABLED: Whether knowledge graph is enabled (true/false)
 * - KNOWLEDGE_GRAPH_TYPE: Backend type (neo4j, in-memory)
 * - KNOWLEDGE_GRAPH_HOST: Neo4j host (if using Neo4j)
 * - KNOWLEDGE_GRAPH_PORT: Neo4j port (if using Neo4j)
 * - KNOWLEDGE_GRAPH_URI: Neo4j URI (if using Neo4j)
 * - KNOWLEDGE_GRAPH_USERNAME: Neo4j username (if using Neo4j)
 * - KNOWLEDGE_GRAPH_PASSWORD: Neo4j password (if using Neo4j)
 * - KNOWLEDGE_GRAPH_DATABASE: Neo4j database name
 *
 * @returns Promise resolving to manager and connected knowledge graph, or null if disabled
 *
 * @example
 * ```typescript
 * // Set environment variables
 * process.env.KNOWLEDGE_GRAPH_ENABLED = 'true';
 * process.env.KNOWLEDGE_GRAPH_TYPE = 'neo4j';
 * process.env.KNOWLEDGE_GRAPH_HOST = 'localhost';
 * process.env.KNOWLEDGE_GRAPH_USERNAME = 'neo4j';
 * process.env.KNOWLEDGE_GRAPH_PASSWORD = 'password';
 *
 * const result = await createKnowledgeGraphFromEnv();
 * if (result) {
 *   const { manager, graph } = result;
 *   // Use the knowledge graph
 * } else {
 *   console.log('Knowledge graph is disabled');
 * }
 * ```
 */
export async function createKnowledgeGraphFromEnv(): Promise<KnowledgeGraphFactory | null> {
	const logger = createLogger({ level: env.CIPHER_LOG_LEVEL });

	// Get configuration from environment variables
	const config = parseKnowledgeGraphConfigFromEnv();

	if (!config) {
		logger.info(`${LOG_PREFIXES.FACTORY} Knowledge graph is disabled in environment`);
		return null;
	}

	logger.info(`${LOG_PREFIXES.FACTORY} Creating knowledge graph from environment`, {
		type: config.type,
		enableAutoIndexing: config.enableAutoIndexing,
		enableMetrics: config.enableMetrics,
	});

	return createKnowledgeGraph(config);
}

/**
 * Creates Neo4j knowledge graph with specific configuration
 *
 * Convenience function for creating Neo4j backend with commonly used settings.
 *
 * @param connectionConfig - Neo4j connection configuration
 * @param options - Optional system configuration
 * @returns Promise resolving to manager and connected knowledge graph
 *
 * @example
 * ```typescript
 * const { manager, graph } = await createNeo4jKnowledgeGraph({
 *   host: 'localhost',
 *   port: 7687,
 *   username: 'neo4j',
 *   password: 'password',
 *   database: 'knowledge'
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Using URI connection
 * const { manager, graph } = await createNeo4jKnowledgeGraph({
 *   uri: 'neo4j://localhost:7687',
 *   username: 'neo4j',
 *   password: 'password',
 *   database: 'knowledge'
 * });
 * ```
 */
export async function createNeo4jKnowledgeGraph(
	connectionConfig: {
		uri?: string;
		host?: string;
		port?: number;
		username: string;
		password: string;
		database?: string;
		encrypted?: boolean;
		trustServerCertificate?: boolean;
		connectionTimeout?: number;
		maxPoolSize?: number;
	},
	options: {
		enableAutoIndexing?: boolean;
		enableMetrics?: boolean;
		enableQueryCache?: boolean;
		queryCacheTTL?: number;
		enableSchemaValidation?: boolean;
		defaultBatchSize?: number;
	} = {}
): Promise<KnowledgeGraphFactory> {
	const config: KnowledgeGraphConfig = {
		type: BACKEND_TYPES.NEO4J,
		timeout: connectionConfig.connectionTimeout ?? 30000,
		maxRetries: 3,
		enablePooling: true,
		poolSize: connectionConfig.maxPoolSize ?? 10,
		...connectionConfig,
		database: connectionConfig.database || 'neo4j',
		encrypted: connectionConfig.encrypted ?? false,
		trustServerCertificate: connectionConfig.trustServerCertificate ?? false,
		// Required Neo4j-specific properties with defaults
		maxTransactionRetryTime: 30000,
		connectionAcquisitionTimeout: 60000,
		maxConnectionLifetime: 3600000,
		connectionLivenessCheckTimeout: 30000,
		enableAutoIndexing: options.enableAutoIndexing ?? true,
		enableMetrics: options.enableMetrics ?? false,
		enableQueryCache: options.enableQueryCache ?? true,
		queryCacheTTL: options.queryCacheTTL ?? 300000,
		enableSchemaValidation: options.enableSchemaValidation ?? true,
		defaultBatchSize: options.defaultBatchSize ?? 1000,
	};

	return createKnowledgeGraph(config);
}

/**
 * Creates in-memory knowledge graph with specific configuration
 *
 * Convenience function for creating in-memory backend with commonly used settings.
 *
 * @param options - Optional configuration options
 * @returns Promise resolving to manager and connected knowledge graph
 *
 * @example
 * ```typescript
 * const { manager, graph } = await createInMemoryKnowledgeGraph({
 *   maxNodes: 5000,
 *   maxEdges: 25000,
 *   enableIndexing: true,
 *   enableGarbageCollection: true
 * });
 * ```
 */
export async function createInMemoryKnowledgeGraph(
	options: {
		maxNodes?: number;
		maxEdges?: number;
		enableIndexing?: boolean;
		enableGarbageCollection?: boolean;
		enableAutoIndexing?: boolean;
		enableMetrics?: boolean;
		enableQueryCache?: boolean;
		queryCacheTTL?: number;
		enableSchemaValidation?: boolean;
		defaultBatchSize?: number;
	} = {}
): Promise<KnowledgeGraphFactory> {
	const config: KnowledgeGraphConfig = {
		type: BACKEND_TYPES.IN_MEMORY,
		timeout: 30000,
		maxRetries: 3,
		enablePooling: true,
		poolSize: 10,
		maxNodes: options.maxNodes ?? DEFAULTS.MAX_NODES,
		maxEdges: options.maxEdges ?? DEFAULTS.MAX_EDGES,
		enableIndexing: options.enableIndexing ?? true,
		enableGarbageCollection: options.enableGarbageCollection ?? false,
		enableAutoIndexing: options.enableAutoIndexing ?? true,
		enableMetrics: options.enableMetrics ?? false,
		enableQueryCache: options.enableQueryCache ?? true,
		queryCacheTTL: options.queryCacheTTL ?? 300000,
		enableSchemaValidation: options.enableSchemaValidation ?? true,
		defaultBatchSize: options.defaultBatchSize ?? 1000,
	};

	return createKnowledgeGraph(config);
}

/**
 * Get knowledge graph configuration from environment variables
 *
 * Returns the configuration object that would be used by createKnowledgeGraphFromEnv
 * without actually creating the knowledge graph. Useful for debugging and validation.
 *
 * @returns Knowledge graph configuration based on environment variables, or null if disabled
 *
 * @example
 * ```typescript
 * const config = getKnowledgeGraphConfigFromEnv();
 * if (config) {
 *   console.log('Knowledge graph configuration:', config);
 *   // Then use the config to create the graph
 *   const { manager, graph } = await createKnowledgeGraph(config);
 * } else {
 *   console.log('Knowledge graph is disabled');
 * }
 * ```
 */
export function getKnowledgeGraphConfigFromEnv(): KnowledgeGraphConfig | null {
	return parseKnowledgeGraphConfigFromEnv();
}

/**
 * Type guard to check if an object is a KnowledgeGraphFactory
 *
 * @param obj - Object to check
 * @returns True if the object is a KnowledgeGraphFactory
 *
 * @example
 * ```typescript
 * const factory = await createKnowledgeGraph(config);
 * if (isKnowledgeGraphFactory(factory)) {
 *   // TypeScript knows factory has manager and graph properties
 *   console.log('Manager connected:', factory.manager.isConnected());
 * }
 * ```
 */
export function isKnowledgeGraphFactory(obj: unknown): obj is KnowledgeGraphFactory {
	return (
		typeof obj === 'object' &&
		obj !== null &&
		'manager' in obj &&
		'graph' in obj &&
		typeof (obj as any).manager === 'object' &&
		typeof (obj as any).graph === 'object'
	);
}

/**
 * Check if Neo4j configuration is available in environment
 *
 * @returns True if Neo4j connection can be configured from environment variables
 *
 * @example
 * ```typescript
 * if (isNeo4jConfigAvailable()) {
 *   console.log('Neo4j configuration is available');
 *   const factory = await createKnowledgeGraphFromEnv();
 * } else {
 *   console.log('Using fallback configuration');
 *   const factory = await createDefaultKnowledgeGraph();
 * }
 * ```
 */
export function isNeo4jConfigAvailable(): boolean {
	return !!(
		process.env.KNOWLEDGE_GRAPH_ENABLED === 'true' &&
		process.env.KNOWLEDGE_GRAPH_TYPE === 'neo4j' &&
		process.env.KNOWLEDGE_GRAPH_USERNAME &&
		process.env.KNOWLEDGE_GRAPH_PASSWORD &&
		(process.env.KNOWLEDGE_GRAPH_URI ||
			(process.env.KNOWLEDGE_GRAPH_HOST && process.env.KNOWLEDGE_GRAPH_PORT))
	);
}

/**
 * Check if knowledge graph is enabled in environment
 *
 * @returns True if knowledge graph is enabled in environment variables
 *
 * @example
 * ```typescript
 * if (isKnowledgeGraphEnabled()) {
 *   const factory = await createKnowledgeGraphFromEnv();
 *   // Knowledge graph is available
 * } else {
 *   // Skip knowledge graph functionality
 * }
 * ```
 */
export function isKnowledgeGraphEnabled(): boolean {
	return process.env.KNOWLEDGE_GRAPH_ENABLED === 'true';
}
