/**
 * Neo4j Knowledge Graph Backend
 *
 * Production-grade graph database implementation using Neo4j.
 * Provides full Cipher query support and advanced graph operations.
 *
 * @module knowledge_graph/backend/neo4j
 */

import neo4j from 'neo4j-driver';
// TODO: Install neo4j-driver package: pnpm install neo4j-driver
type Driver = any;
type Session = any;

// Stub for neo4j when package is not installed
// const neo4j = {
// 	auth: {
// 		basic: (username: string, password: string) => ({ username, password }),
// 	},
// 	driver: (uri: string, auth: any, config: any) => {
// 		throw new Error('neo4j-driver package not installed. Please run: npm install neo4j-driver');
// 	},
// };
import { Logger, createLogger } from '../../logger/logger.js';
import type { KnowledgeGraph } from './knowledge-graph.js';
import type {
	GraphNode,
	GraphEdge,
	GraphQuery,
	GraphResult,
	NodeFilters,
	EdgeFilters,
} from './types.js';
import {
	KnowledgeGraphConnectionError,
	NodeNotFoundError,
	EdgeNotFoundError,
	InvalidQueryError,
	GraphValidationError,
} from './types.js';
import type { Neo4jBackendConfig } from '../config.js';
import { DEFAULTS, ERROR_MESSAGES, LOG_PREFIXES } from '../constants.js';

/**
 * Neo4j Knowledge Graph Backend
 *
 * Provides a production-grade implementation using Neo4j graph database.
 * Supports Cypher queries, transactions, and advanced graph operations.
 *
 * @example
 * ```typescript
 * const backend = new Neo4jBackend({
 *   type: 'neo4j',
 *   host: 'localhost',
 *   port: 7687,
 *   username: 'neo4j',
 *   password: 'password',
 *   database: 'neo4j'
 * });
 *
 * await backend.connect();
 * await backend.addNode({
 *   id: 'node1',
 *   labels: ['Function'],
 *   properties: { name: 'myFunction' }
 * });
 * ```
 */
export class Neo4jBackend implements KnowledgeGraph {
	private readonly config: Neo4jBackendConfig;
	private readonly logger: Logger;
	private driver: Driver | null = null;
	private connected = false;

	constructor(config: Neo4jBackendConfig) {
		this.config = {
			...config,
			timeout: config.timeout ?? DEFAULTS.CONNECTION_TIMEOUT,
			maxRetries: config.maxRetries ?? DEFAULTS.MAX_RETRIES,
			enablePooling: config.enablePooling ?? true,
			poolSize: config.poolSize ?? DEFAULTS.POOL_SIZE,
			database: config.database ?? DEFAULTS.NEO4J_DATABASE,
			encrypted: config.encrypted ?? false,
			trustServerCertificate: config.trustServerCertificate ?? false,
			maxTransactionRetryTime:
				config.maxTransactionRetryTime ?? DEFAULTS.NEO4J_MAX_TRANSACTION_RETRY_TIME,
			connectionAcquisitionTimeout:
				config.connectionAcquisitionTimeout ?? DEFAULTS.NEO4J_CONNECTION_ACQUISITION_TIMEOUT,
			maxConnectionLifetime: config.maxConnectionLifetime ?? DEFAULTS.NEO4J_MAX_CONNECTION_LIFETIME,
			connectionLivenessCheckTimeout:
				config.connectionLivenessCheckTimeout ?? DEFAULTS.NEO4J_CONNECTION_LIVENESS_CHECK_TIMEOUT,
		};

		this.logger = createLogger({
			level: 'debug',
		});

		this.logger.debug(`${LOG_PREFIXES.NEO4J} Initialized with config:`, {
			uri: this.buildConnectionUri(),
			database: this.config.database,
			encrypted: this.config.encrypted,
			poolSize: this.config.poolSize,
		});
	}

	// Connection management

	async connect(): Promise<void> {
		if (this.connected && this.driver) {
			this.logger.debug(`${LOG_PREFIXES.NEO4J} Already connected`);
			return;
		}

		try {
			const uri = this.buildConnectionUri();
			const auth = neo4j.auth.basic(this.config.username, this.config.password);

			const driverConfig: any = {
				maxConnectionPoolSize: this.config.poolSize,
				connectionAcquisitionTimeout: this.config.connectionAcquisitionTimeout,
				maxTransactionRetryTime: this.config.maxTransactionRetryTime,
				maxConnectionLifetime: this.config.maxConnectionLifetime,
				connectionLivenessCheckTimeout: this.config.connectionLivenessCheckTimeout,
			};

			this.logger.debug(`${LOG_PREFIXES.NEO4J} Creating driver for ${uri}`);
			this.driver = neo4j.driver(uri, auth, driverConfig);

			// Test connection
			await this.driver.verifyConnectivity();

			this.connected = true;
			this.logger.info(`${LOG_PREFIXES.NEO4J} Connected successfully to ${uri}`);

			// Create indexes for performance
			await this.createIndexes();
		} catch (error) {
			// Log detailed error for MCP visibility (console.error not captured)
			this.logger.error(`${LOG_PREFIXES.NEO4J} Connection error details:`, error);
			const connectionError = new KnowledgeGraphConnectionError(
				`${ERROR_MESSAGES.CONNECTION_FAILED}: ${(error as Error).message}`,
				'neo4j',
				error as Error
			);
			this.logger.error(`${LOG_PREFIXES.NEO4J} Connection failed:`, connectionError);
			throw connectionError;
		}
	}

	async disconnect(): Promise<void> {
		if (!this.connected || !this.driver) {
			this.logger.debug(`${LOG_PREFIXES.NEO4J} Already disconnected`);
			return;
		}

		try {
			await this.driver.close();
			this.driver = null;
			this.connected = false;
			this.logger.info(`${LOG_PREFIXES.NEO4J} Disconnected successfully`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.NEO4J} Error during disconnect:`, error);
			throw error;
		}
	}

	isConnected(): boolean {
		return this.connected && this.driver !== null;
	}

	getBackendType(): string {
		return 'neo4j';
	}

	// Node operations

	async addNode(node: GraphNode): Promise<void> {
		this.ensureConnected();
		this.validateNode(node);

		const session = this.getSession();
		try {
			const labelsStr = node.labels.map(label => `\`${label}\``).join(':');
			const query = `CREATE (n:${labelsStr}) SET n = $properties, n.id = $id RETURN n`;

			const result = await session.run(query, {
				id: node.id,
				properties: node.properties,
			});

			if (result.records.length === 0) {
				throw new GraphValidationError('Failed to create node', 'node');
			}

			this.logger.debug(`${LOG_PREFIXES.NEO4J} Added node:`, { id: node.id, labels: node.labels });
		} catch (error) {
			if ((error as any).code === 'Neo.ClientError.Schema.ConstraintValidationFailed') {
				throw new GraphValidationError(
					`Node with ID '${node.id}' already exists`,
					'node',
					error as Error
				);
			}
			throw error;
		} finally {
			await session.close();
		}
	}

	async addNodes(nodes: GraphNode[]): Promise<void> {
		this.ensureConnected();

		// Validate all nodes first
		for (const node of nodes) {
			this.validateNode(node);
		}

		const session = this.getSession();
		try {
			const tx = session.beginTransaction();

			for (const node of nodes) {
				const labelsStr = node.labels.map(label => `\`${label}\``).join(':');
				const query = `CREATE (n:${labelsStr}) SET n = $properties, n.id = $id`;

				await tx.run(query, {
					id: node.id,
					properties: node.properties,
				});
			}

			await tx.commit();
			this.logger.debug(`${LOG_PREFIXES.NEO4J} Added ${nodes.length} nodes`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.NEO4J} Error adding nodes:`, error);
			throw error;
		} finally {
			await session.close();
		}
	}

	async getNode(nodeId: string): Promise<GraphNode | null> {
		this.ensureConnected();

		const session = this.getSession();
		try {
			const query = 'MATCH (n) WHERE n.id = $id RETURN n, labels(n) as nodeLabels';
			const result = await session.run(query, { id: nodeId });

			if (result.records.length === 0) {
				return null;
			}

			const record = result.records[0];
			const nodeData = record.get('n').properties;
			const labels = record.get('nodeLabels');

			return {
				id: nodeId,
				labels: labels,
				properties: this.convertNeo4jProperties(nodeData),
			};
		} finally {
			await session.close();
		}
	}

	async updateNode(
		nodeId: string,
		properties: Record<string, any>,
		labels?: string[]
	): Promise<void> {
		this.ensureConnected();

		const session = this.getSession();
		try {
			// Check if node exists
			const existsResult = await session.run('MATCH (n) WHERE n.id = $id RETURN n', { id: nodeId });

			if (existsResult.records.length === 0) {
				throw new NodeNotFoundError(ERROR_MESSAGES.NODE_NOT_FOUND, nodeId);
			}

			// Update properties
			let query = 'MATCH (n) WHERE n.id = $id SET n += $properties';
			const params: any = { id: nodeId, properties };

			// Update labels if provided
			if (labels && labels.length > 0) {
				// Remove all existing labels and add new ones
				const labelsStr = labels.map(label => `\`${label}\``).join(':');
				query = `MATCH (n) WHERE n.id = $id REMOVE n:${labelsStr} SET n:${labelsStr}, n += $properties`;
			}

			await session.run(query, params);

			this.logger.debug(`${LOG_PREFIXES.NEO4J} Updated node:`, { id: nodeId });
		} finally {
			await session.close();
		}
	}

	async deleteNode(nodeId: string): Promise<void> {
		this.ensureConnected();

		const session = this.getSession();
		try {
			const query = 'MATCH (n) WHERE n.id = $id DETACH DELETE n';
			await session.run(query, { id: nodeId });

			this.logger.debug(`${LOG_PREFIXES.NEO4J} Deleted node:`, { id: nodeId });
		} finally {
			await session.close();
		}
	}

	async findNodes(filters?: NodeFilters, labels?: string[], limit?: number): Promise<GraphNode[]> {
		this.ensureConnected();

		const session = this.getSession();
		try {
			let query = 'MATCH (n)';
			const params: any = {};

			// Add label filters
			if (labels && labels.length > 0) {
				const labelConstraints = labels.map(label => `n:\`${label}\``).join(' OR ');
				query += ` WHERE (${labelConstraints})`;
			}

			// Add property filters
			if (filters) {
				const filterConstraints = this.buildFilterConstraints(filters, 'n', params);
				if (filterConstraints) {
					query +=
						labels && labels.length > 0
							? ` AND ${filterConstraints}`
							: ` WHERE ${filterConstraints}`;
				}
			}

			query += ' RETURN n, labels(n) as nodeLabels';

			// Add limit
			if (limit) {
				query += ` LIMIT ${limit}`;
			}

			const result = await session.run(query, params);
			const nodes: GraphNode[] = [];

			for (const record of result.records) {
				const nodeData = record.get('n').properties;
				const nodeLabels = record.get('nodeLabels');

				nodes.push({
					id: nodeData.id,
					labels: nodeLabels,
					properties: this.convertNeo4jProperties(nodeData),
				});
			}

			this.logger.debug(`${LOG_PREFIXES.NEO4J} Found ${nodes.length} nodes`);
			return nodes;
		} finally {
			await session.close();
		}
	}

	// Edge operations

	async addEdge(edge: GraphEdge): Promise<void> {
		this.ensureConnected();
		this.validateEdge(edge);

		const session = this.getSession();
		try {
			const query = `
				MATCH (a), (b) 
				WHERE a.id = $startId AND b.id = $endId 
				CREATE (a)-[r:\`${edge.type}\`]->(b) 
				SET r = $properties, r.id = $edgeId 
				RETURN r
			`;

			const result = await session.run(query, {
				startId: edge.startNodeId,
				endId: edge.endNodeId,
				edgeId: edge.id,
				properties: edge.properties,
			});

			if (result.records.length === 0) {
				throw new GraphValidationError(
					`Failed to create edge: start node '${edge.startNodeId}' or end node '${edge.endNodeId}' not found`,
					'edge'
				);
			}

			this.logger.debug(`${LOG_PREFIXES.NEO4J} Added edge:`, {
				id: edge.id,
				type: edge.type,
				from: edge.startNodeId,
				to: edge.endNodeId,
			});
		} catch (error) {
			if ((error as any).code === 'Neo.ClientError.Schema.ConstraintValidationFailed') {
				throw new GraphValidationError(
					`Edge with ID '${edge.id}' already exists`,
					'edge',
					error as Error
				);
			}
			throw error;
		} finally {
			await session.close();
		}
	}

	async addEdges(edges: GraphEdge[]): Promise<void> {
		this.ensureConnected();

		// Validate all edges first
		for (const edge of edges) {
			this.validateEdge(edge);
		}

		const session = this.getSession();
		try {
			const tx = session.beginTransaction();

			for (const edge of edges) {
				const query = `
					MATCH (a), (b) 
					WHERE a.id = $startId AND b.id = $endId 
					CREATE (a)-[r:\`${edge.type}\`]->(b) 
					SET r = $properties, r.id = $edgeId
				`;

				await tx.run(query, {
					startId: edge.startNodeId,
					endId: edge.endNodeId,
					edgeId: edge.id,
					properties: edge.properties,
				});
			}

			await tx.commit();
			this.logger.debug(`${LOG_PREFIXES.NEO4J} Added ${edges.length} edges`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.NEO4J} Error adding edges:`, error);
			throw error;
		} finally {
			await session.close();
		}
	}

	async getEdge(edgeId: string): Promise<GraphEdge | null> {
		this.ensureConnected();

		const session = this.getSession();
		try {
			const query = `
				MATCH (a)-[r]->(b) 
				WHERE r.id = $id 
				RETURN r, a.id as startId, b.id as endId, type(r) as edgeType
			`;
			const result = await session.run(query, { id: edgeId });

			if (result.records.length === 0) {
				return null;
			}

			const record = result.records[0];
			const edgeData = record.get('r').properties;
			const startId = record.get('startId');
			const endId = record.get('endId');
			const edgeType = record.get('edgeType');

			return {
				id: edgeId,
				type: edgeType,
				startNodeId: startId,
				endNodeId: endId,
				properties: this.convertNeo4jProperties(edgeData),
			};
		} finally {
			await session.close();
		}
	}

	async updateEdge(edgeId: string, properties: Record<string, any>): Promise<void> {
		this.ensureConnected();

		const session = this.getSession();
		try {
			// Check if edge exists
			const existsResult = await session.run('MATCH ()-[r]-() WHERE r.id = $id RETURN r', {
				id: edgeId,
			});

			if (existsResult.records.length === 0) {
				throw new EdgeNotFoundError(ERROR_MESSAGES.EDGE_NOT_FOUND, edgeId);
			}

			// Update properties
			const query = 'MATCH ()-[r]-() WHERE r.id = $id SET r += $properties';
			await session.run(query, { id: edgeId, properties });

			this.logger.debug(`${LOG_PREFIXES.NEO4J} Updated edge:`, { id: edgeId });
		} finally {
			await session.close();
		}
	}

	async deleteEdge(edgeId: string): Promise<void> {
		this.ensureConnected();

		const session = this.getSession();
		try {
			const query = 'MATCH ()-[r]-() WHERE r.id = $id DELETE r';
			await session.run(query, { id: edgeId });

			this.logger.debug(`${LOG_PREFIXES.NEO4J} Deleted edge:`, { id: edgeId });
		} finally {
			await session.close();
		}
	}

	async findEdges(filters?: EdgeFilters, edgeType?: string, limit?: number): Promise<GraphEdge[]> {
		this.ensureConnected();

		const session = this.getSession();
		try {
			let query = 'MATCH (a)-[r]->(b)';
			const params: any = {};

			// Add type filter
			if (edgeType) {
				query = `MATCH (a)-[r:\`${edgeType}\`]->(b)`;
			}

			// Add property filters
			if (filters) {
				const filterConstraints = this.buildFilterConstraints(filters, 'r', params);
				if (filterConstraints) {
					query += ` WHERE ${filterConstraints}`;
				}
			}

			query += ' RETURN r, a.id as startId, b.id as endId, type(r) as edgeType';

			// Add limit
			if (limit) {
				query += ` LIMIT ${limit}`;
			}

			const result = await session.run(query, params);
			const edges: GraphEdge[] = [];

			for (const record of result.records) {
				const edgeData = record.get('r').properties;
				const startId = record.get('startId');
				const endId = record.get('endId');
				const type = record.get('edgeType');

				edges.push({
					id: edgeData.id,
					type: type,
					startNodeId: startId,
					endNodeId: endId,
					properties: this.convertNeo4jProperties(edgeData),
				});
			}

			this.logger.debug(`${LOG_PREFIXES.NEO4J} Found ${edges.length} edges`);
			return edges;
		} finally {
			await session.close();
		}
	}

	// Advanced operations

	async query(query: GraphQuery): Promise<GraphResult> {
		this.ensureConnected();

		const startTime = Date.now();
		const session = this.getSession();

		try {
			let result: GraphResult;

			switch (query.type) {
				case 'node':
					result = await this.executeNodeQuery(query, session);
					break;
				case 'edge':
					result = await this.executeEdgeQuery(query, session);
					break;
				case 'path':
					result = await this.executePathQuery(query, session);
					break;
				case 'cypher':
					result = await this.executeCypherQuery(query, session);
					break;
				default:
					throw new InvalidQueryError(`Unsupported query type: ${(query as any).type}`, query);
			}

			result.metadata.executionTime = Date.now() - startTime;
			return result;
		} catch (error) {
			throw new InvalidQueryError(
				`Query execution failed: ${(error as Error).message}`,
				query,
				error as Error
			);
		} finally {
			await session.close();
		}
	}

	async getNeighbors(
		nodeId: string,
		direction: 'in' | 'out' | 'both' = 'both',
		edgeTypes?: string[],
		limit?: number
	): Promise<Array<{ node: GraphNode; edge: GraphEdge }>> {
		this.ensureConnected();

		const session = this.getSession();
		try {
			let relationshipPattern: string;

			switch (direction) {
				case 'in':
					relationshipPattern = '<-[r]-';
					break;
				case 'out':
					relationshipPattern = '-[r]->';
					break;
				case 'both':
					relationshipPattern = '-[r]-';
					break;
			}

			// Add edge type filters
			if (edgeTypes && edgeTypes.length > 0) {
				const typeStr = edgeTypes.map(type => `\`${type}\``).join('|');
				relationshipPattern = relationshipPattern.replace('[r]', `[r:${typeStr}]`);
			}

			let query = `
				MATCH (n)${relationshipPattern}(m) 
				WHERE n.id = $nodeId 
				RETURN m, labels(m) as nodeLabels, r, type(r) as edgeType, n.id as startId, m.id as endId
			`;

			if (limit) {
				query += ` LIMIT ${limit}`;
			}

			const result = await session.run(query, { nodeId });
			const neighbors: Array<{ node: GraphNode; edge: GraphEdge }> = [];

			for (const record of result.records) {
				const nodeData = record.get('m').properties;
				const nodeLabels = record.get('nodeLabels');
				const edgeData = record.get('r').properties;
				const edgeType = record.get('edgeType');
				const startId = record.get('startId');
				const endId = record.get('endId');

				neighbors.push({
					node: {
						id: nodeData.id,
						labels: nodeLabels,
						properties: this.convertNeo4jProperties(nodeData),
					},
					edge: {
						id: edgeData.id,
						type: edgeType,
						startNodeId: startId,
						endNodeId: endId,
						properties: this.convertNeo4jProperties(edgeData),
					},
				});
			}

			this.logger.debug(
				`${LOG_PREFIXES.NEO4J} Found ${neighbors.length} neighbors for node ${nodeId}`
			);
			return neighbors;
		} finally {
			await session.close();
		}
	}

	async findPath(
		startNodeId: string,
		endNodeId: string,
		maxDepth: number = DEFAULTS.MAX_PATH_DEPTH,
		edgeTypes?: string[]
	): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] } | null> {
		this.ensureConnected();

		const session = this.getSession();
		try {
			let relationshipPattern = '*1..' + maxDepth;

			if (edgeTypes && edgeTypes.length > 0) {
				const typeStr = edgeTypes.map(type => `\`${type}\``).join('|');
				relationshipPattern = `:${typeStr}${relationshipPattern}`;
			}

			const query = `
				MATCH path = shortestPath((a)-[${relationshipPattern}]-(b)) 
				WHERE a.id = $startId AND b.id = $endId 
				RETURN path
			`;

			const result = await session.run(query, {
				startId: startNodeId,
				endId: endNodeId,
			});

			if (result.records.length === 0) {
				this.logger.debug(
					`${LOG_PREFIXES.NEO4J} No path found from ${startNodeId} to ${endNodeId}`
				);
				return null;
			}

			const path = result.records[0].get('path');
			const nodes: GraphNode[] = [];
			const edges: GraphEdge[] = [];

			// Extract nodes
			for (const nodeRecord of path.segments.flatMap((segment: any) => [
				segment.start,
				segment.end,
			])) {
				const nodeData = nodeRecord.properties;
				const labels = nodeRecord.labels;

				nodes.push({
					id: nodeData.id,
					labels: labels,
					properties: this.convertNeo4jProperties(nodeData),
				});
			}

			// Extract edges
			for (const segment of path.segments) {
				const edgeData = segment.relationship.properties;
				const startNodeData = segment.start.properties;
				const endNodeData = segment.end.properties;

				edges.push({
					id: edgeData.id,
					type: segment.relationship.type,
					startNodeId: startNodeData.id,
					endNodeId: endNodeData.id,
					properties: this.convertNeo4jProperties(edgeData),
				});
			}

			// Remove duplicates
			const uniqueNodes = nodes.filter(
				(node, index, self) => index === self.findIndex(n => n.id === node.id)
			);

			this.logger.debug(
				`${LOG_PREFIXES.NEO4J} Found path from ${startNodeId} to ${endNodeId} with ${edges.length} edges`
			);

			return { nodes: uniqueNodes, edges };
		} finally {
			await session.close();
		}
	}

	// Graph management

	async clearGraph(): Promise<void> {
		this.ensureConnected();

		const session = this.getSession();
		try {
			await session.run('MATCH (n) DETACH DELETE n');
			this.logger.info(`${LOG_PREFIXES.NEO4J} Graph cleared`);
		} finally {
			await session.close();
		}
	}

	async getStatistics(): Promise<{
		nodeCount: number;
		edgeCount: number;
		labelCounts: Record<string, number>;
		edgeTypeCounts: Record<string, number>;
	}> {
		this.ensureConnected();

		const session = this.getSession();
		try {
			// Get node count
			const nodeCountResult = await session.run('MATCH (n) RETURN count(n) as count');
			const nodeCount = nodeCountResult.records[0].get('count').toNumber();

			// Get edge count
			const edgeCountResult = await session.run('MATCH ()-[r]-() RETURN count(r) as count');
			const edgeCount = edgeCountResult.records[0].get('count').toNumber();

			// Get label counts
			const labelCountsResult = await session.run(`
				CALL db.labels() YIELD label
				CALL apoc.cypher.run('MATCH (n:\`' + label + '\`) RETURN count(n) as count', {}) YIELD value
				RETURN label, value.count as count
			`);

			const labelCounts: Record<string, number> = {};
			for (const record of labelCountsResult.records) {
				const label = record.get('label');
				const count = record.get('count').toNumber();
				labelCounts[label] = count;
			}

			// Get edge type counts
			const edgeTypeCountsResult = await session.run(`
				CALL db.relationshipTypes() YIELD relationshipType
				CALL apoc.cypher.run('MATCH ()-[r:\`' + relationshipType + '\`]-() RETURN count(r) as count', {}) YIELD value
				RETURN relationshipType, value.count as count
			`);

			const edgeTypeCounts: Record<string, number> = {};
			for (const record of edgeTypeCountsResult.records) {
				const type = record.get('relationshipType');
				const count = record.get('count').toNumber();
				edgeTypeCounts[type] = count;
			}

			return {
				nodeCount,
				edgeCount,
				labelCounts,
				edgeTypeCounts,
			};
		} finally {
			await session.close();
		}
	}

	// Private helper methods

	private ensureConnected(): void {
		if (!this.connected || !this.driver) {
			throw new KnowledgeGraphConnectionError(ERROR_MESSAGES.NOT_CONNECTED, 'neo4j');
		}
	}

	private getSession(): Session {
		if (!this.driver) {
			throw new KnowledgeGraphConnectionError(ERROR_MESSAGES.NOT_CONNECTED, 'neo4j');
		}

		return this.driver.session({
			database: this.config.database,
			defaultAccessMode: neo4j.session.WRITE,
		});
	}

	private buildConnectionUri(): string {
		if (this.config.uri) {
			return this.config.uri;
		}

		const protocol = this.config.encrypted ? 'neo4j+s' : 'neo4j';
		const port = this.config.port ?? DEFAULTS.NEO4J_PORT;
		return `${protocol}://${this.config.host}:${port}`;
	}

	private validateNode(node: GraphNode): void {
		if (!node.id || typeof node.id !== 'string') {
			throw new GraphValidationError('Node ID must be a non-empty string', 'node');
		}

		if (!Array.isArray(node.labels) || node.labels.length === 0) {
			throw new GraphValidationError('Node must have at least one label', 'node');
		}

		if (!node.properties || typeof node.properties !== 'object') {
			throw new GraphValidationError('Node properties must be an object', 'node');
		}
	}

	private validateEdge(edge: GraphEdge): void {
		if (!edge.id || typeof edge.id !== 'string') {
			throw new GraphValidationError('Edge ID must be a non-empty string', 'edge');
		}

		if (!edge.type || typeof edge.type !== 'string') {
			throw new GraphValidationError('Edge type must be a non-empty string', 'edge');
		}

		if (!edge.startNodeId || typeof edge.startNodeId !== 'string') {
			throw new GraphValidationError('Edge startNodeId must be a non-empty string', 'edge');
		}

		if (!edge.endNodeId || typeof edge.endNodeId !== 'string') {
			throw new GraphValidationError('Edge endNodeId must be a non-empty string', 'edge');
		}

		if (!edge.properties || typeof edge.properties !== 'object') {
			throw new GraphValidationError('Edge properties must be an object', 'edge');
		}
	}

	private convertNeo4jProperties(properties: any): Record<string, any> {
		const converted: Record<string, any> = {};

		for (const [key, value] of Object.entries(properties)) {
			// Convert Neo4j integers to regular numbers if they're within safe range
			if (value && typeof value === 'object' && 'toNumber' in value) {
				converted[key] = (value as any).toNumber();
			} else {
				converted[key] = value;
			}
		}

		return converted;
	}

        private buildFilterConstraints(
                filters: NodeFilters | EdgeFilters,
                prefix: string,
                params: any
        ): string {
                const constraints: string[] = [];

                for (const [rawKey, filter] of Object.entries(filters)) {
                        const propertyKey = this.escapePropertyKey(rawKey);
                        const paramKey = `${prefix}_${Object.keys(params).length}`;

                        if (typeof filter === 'object' && filter !== null && !Array.isArray(filter)) {
                                // Range filters
                                if ('gte' in filter) {
                                        constraints.push(`${prefix}.${propertyKey} >= $${paramKey}_gte`);
                                        params[`${paramKey}_gte`] = filter.gte;
                                }
                                if ('gt' in filter) {
                                        constraints.push(`${prefix}.${propertyKey} > $${paramKey}_gt`);
                                        params[`${paramKey}_gt`] = filter.gt;
                                }
                                if ('lte' in filter) {
                                        constraints.push(`${prefix}.${propertyKey} <= $${paramKey}_lte`);
                                        params[`${paramKey}_lte`] = filter.lte;
                                }
                                if ('lt' in filter) {
                                        constraints.push(`${prefix}.${propertyKey} < $${paramKey}_lt`);
                                        params[`${paramKey}_lt`] = filter.lt;
                                }

                                // Array filters
                                if ('any' in filter && Array.isArray(filter.any)) {
                                        constraints.push(`${prefix}.${propertyKey} IN $${paramKey}`);
                                        params[paramKey] = filter.any;
                                }
                                if ('all' in filter && Array.isArray(filter.all)) {
                                        // For 'all' filter, check if the property (assumed to be array) contains all values
                                        constraints.push(
                                                `all(x IN $${paramKey} WHERE x IN ${prefix}.${propertyKey})`
                                        );
                                        params[paramKey] = filter.all;
                                }
                        } else {
                                // Direct equality
                                constraints.push(`${prefix}.${propertyKey} = $${paramKey}`);
                                params[paramKey] = filter;
                        }
                }

                return constraints.join(' AND ');
        }

        private escapePropertyKey(key: string): string {
                if (key.trim().length === 0) {
                        throw new Error('Filter property names must not be empty.');
                }

                if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                        return key;
                }

                const escapedKey = key.replace(/`/g, '``');
                return `\`${escapedKey}\``;
        }

	private async createIndexes(): Promise<void> {
		const session = this.getSession();
		try {
			// Create unique constraint on node ID
			await session.run(
				'CREATE CONSTRAINT node_id_unique IF NOT EXISTS FOR (n:Entity) REQUIRE n.id IS UNIQUE'
			);

			// Create index on node IDs for faster lookups
			await session.run('CREATE INDEX node_id_index IF NOT EXISTS FOR (n:Entity) ON (n.id)');

			// Create index on edge IDs
			await session.run(
				'CREATE INDEX edge_id_index IF NOT EXISTS FOR ()-[r:CONNECTED_TO]-() ON (r.id)'
			);

			this.logger.debug(`${LOG_PREFIXES.NEO4J} Created indexes`);
		} catch (_error) {
			console.log(_error);
			this.logger.warn(`${LOG_PREFIXES.NEO4J} Could not create indexes:`, _error);
		} finally {
			await session.close();
		}
	}

	private async executeNodeQuery(query: GraphQuery, _session: Session): Promise<GraphResult> {
		const { pattern, limit } = query;
		const labels = pattern?.labels;
		const properties = pattern?.properties;

		const nodes = await this.findNodes(properties, labels, limit);

		return {
			nodes,
			edges: [],
			metadata: {
				totalCount: nodes.length,
				queryType: 'node',
			},
		};
	}

	private async executeEdgeQuery(query: GraphQuery, _session: Session): Promise<GraphResult> {
		const { pattern, limit } = query;
		const edgeType = pattern?.type;
		const properties = pattern?.properties;

		const edges = await this.findEdges(properties, edgeType, limit);

		return {
			nodes: [],
			edges,
			metadata: {
				totalCount: edges.length,
				queryType: 'edge',
			},
		};
	}

	private async executePathQuery(query: GraphQuery, _session: Session): Promise<GraphResult> {
		const { pattern, parameters } = query;
		const startNode = pattern?.startNode;
		const endNode = pattern?.endNode;
		const maxDepth = parameters?.maxDepth ?? DEFAULTS.MAX_PATH_DEPTH;

		if (!startNode?.id || !endNode?.id) {
			throw new InvalidQueryError('Path query requires startNode.id and endNode.id', query);
		}

		const path = await this.findPath(startNode.id, endNode.id, maxDepth);

		if (path) {
			return {
				nodes: path.nodes,
				edges: path.edges,
				paths: [
					{
						nodes: path.nodes,
						edges: path.edges,
						length: path.edges.length,
					},
				],
				metadata: {
					totalCount: 1,
					queryType: 'path',
				},
			};
		}

		return {
			nodes: [],
			edges: [],
			paths: [],
			metadata: {
				totalCount: 0,
				queryType: 'path',
			},
		};
	}

	private async executeCypherQuery(query: GraphQuery, session: Session): Promise<GraphResult> {
		if (!query.query) {
			throw new InvalidQueryError('Cypher query requires query string', query);
		}

		const result = await session.run(query.query, query.parameters || {});
		const nodes: GraphNode[] = [];
		const edges: GraphEdge[] = [];

		// Extract nodes and edges from result
		for (const record of result.records) {
			for (const [, value] of record.entries()) {
				if (value && typeof value === 'object') {
					// Check if it's a node
					if ('labels' in value && 'properties' in value) {
						nodes.push({
							id: value.properties.id,
							labels: value.labels,
							properties: this.convertNeo4jProperties(value.properties),
						});
					}
					// Check if it's a relationship
					else if ('type' in value && 'start' in value && 'end' in value) {
						edges.push({
							id: value.properties.id,
							type: value.type,
							startNodeId: value.start.properties.id,
							endNodeId: value.end.properties.id,
							properties: this.convertNeo4jProperties(value.properties),
						});
					}
				}
			}
		}

		return {
			nodes,
			edges,
			metadata: {
				totalCount: result.records.length,
				queryType: 'cypher',
			},
		};
	}
}
