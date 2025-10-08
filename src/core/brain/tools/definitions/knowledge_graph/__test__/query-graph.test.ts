import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryGraphTool } from '../query-graph.js';

const mockQueryResult = {
	nodes: [
		{ id: 'node1', labels: ['Function'], properties: { name: 'testFunction' } },
		{ id: 'node2', labels: ['Class'], properties: { name: 'TestClass' } },
	],
	edges: [
		{ id: 'edge1', type: 'DEPENDS_ON', startNodeId: 'node1', endNodeId: 'node2', properties: {} },
	],
	metadata: {
		totalCount: 3,
		queryType: 'cypher',
		executionTime: 45,
		parameters: {},
	},
};

const mockGraph = {
	query: vi.fn().mockResolvedValue(mockQueryResult),
};

const getContext = (opts: {
	withManager?: boolean;
	withGraph?: boolean;
	backendType?: string;
} = {}) => {
	const kgManager = opts.withManager
		? {
				getGraph: vi.fn().mockReturnValue(opts.withGraph ? mockGraph : null),
				getBackendType: vi.fn().mockReturnValue(opts.backendType || 'neo4j'),
		  }
		: undefined;
	return {
		toolName: 'query_graph',
		startTime: Date.now(),
		sessionId: 'test-session',
		metadata: {},
		services: {
			knowledgeGraphManager: kgManager as any,
		},
	} as any;
};

describe('queryGraphTool', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGraph.query.mockResolvedValue(mockQueryResult);
	});

	it('should execute a cypher query successfully', async () => {
		const context = getContext({ withManager: true, withGraph: true });
		const result = await queryGraphTool.handler(
			{
				query: 'MATCH (n:Function) RETURN n LIMIT 10',
				queryType: 'cypher',
				limit: 10,
				parameters: { functionType: 'async' },
			},
			context
		);

		expect(result.success).toBe(true);
		expect(result.message).toBe('Query executed');
		expect(result.results).toEqual(mockQueryResult);
		expect(result.query.type).toBe('cypher');
		expect(mockGraph.query).toHaveBeenCalledWith({
			type: 'cypher',
			query: 'MATCH (n:Function) RETURN n LIMIT 10',
			parameters: { functionType: 'async' },
			limit: 10,
		});
	});

	it('should execute a node query successfully', async () => {
		const context = getContext({ withManager: true, withGraph: true });
		const result = await queryGraphTool.handler(
			{
				query: 'labels: [Function], properties: {language: "typescript"}',
				queryType: 'node',
			},
			context
		);

		expect(result.success).toBe(true);
		expect(result.message).toBe('Query executed');
		expect(result.results).toEqual(mockQueryResult);
		expect(result.query.type).toBe('node');
		expect(mockGraph.query).toHaveBeenCalledWith({
			type: 'node',
			pattern: {
				labels: ['Function'],
			},
			parameters: {},
			limit: 100,
		});
	});

	it('should execute an edge query successfully', async () => {
		const context = getContext({ withManager: true, withGraph: true });
		const result = await queryGraphTool.handler(
			{
				query: 'type: DEPENDS_ON',
				queryType: 'edge',
				limit: 25,
			},
			context
		);

		expect(result.success).toBe(true);
		expect(result.query.type).toBe('edge');
		expect(mockGraph.query).toHaveBeenCalledWith({
			type: 'edge',
			pattern: {
				type: 'DEPENDS_ON',
			},
			parameters: {},
			limit: 25,
		});
	});

	it('should use default values when not provided', async () => {
		const context = getContext({ withManager: true, withGraph: true });
		const result = await queryGraphTool.handler({ query: 'MATCH (n) RETURN n' }, context);

		expect(result.success).toBe(true);
		expect(result.query.type).toBe('cypher'); // Default queryType
		expect(mockGraph.query).toHaveBeenCalledWith({
			type: 'cypher',
			query: 'MATCH (n) RETURN n',
			parameters: {},
			limit: 100, // Default limit
		});
	});

	it('should handle empty query results', async () => {
		const emptyResult = {
			nodes: [],
			edges: [],
			metadata: { totalCount: 0, queryType: 'cypher', executionTime: 2 },
		};
		mockGraph.query.mockResolvedValue(emptyResult);

		const context = getContext({ withManager: true, withGraph: true });
		const result = await queryGraphTool.handler(
			{ query: 'MATCH (n:NonExistent) RETURN n', queryType: 'cypher' },
			context
		);

		expect(result.success).toBe(true);
		expect(result.message).toBe('Query executed');
		expect(result.results.nodes).toEqual([]);
		expect(result.results.edges).toEqual([]);
	});

	it('should fail if query is missing or empty', async () => {
		const context = getContext({ withManager: true, withGraph: true });
		const result = await queryGraphTool.handler(
			{ query: '', queryType: 'cypher', limit: 10 },
			context
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Query is required and must be a non-empty string');
	});

	it('should fail if limit is out of range (too low)', async () => {
		const context = getContext({ withManager: true, withGraph: true });
		const result = await queryGraphTool.handler(
			{ query: 'MATCH (n) RETURN n', queryType: 'cypher', limit: 0 },
			context
		);

		expect(result.success).toBe(false);
		expect(result.message).toContain('Limit must be between 1 and 1000');
	});

	it('should fail if limit is out of range (too high)', async () => {
		const context = getContext({ withManager: true, withGraph: true });
		const result = await queryGraphTool.handler(
			{ query: 'MATCH (n) RETURN n', queryType: 'cypher', limit: 10001 },
			context
		);

		expect(result.success).toBe(false);
		expect(result.message).toContain('Limit must be between 1 and 1000');
	});

	it('should fail if knowledgeGraphManager is missing', async () => {
		const context = getContext({ withManager: false });
		const result = await queryGraphTool.handler(
			{ query: 'MATCH (n) RETURN n', queryType: 'cypher', limit: 10 },
			context
		);

		expect(result.success).toBe(false);
		expect(result.message).toContain('KnowledgeGraphManager not available in context.services');
	});

	it('should fail if backend is not connected', async () => {
		const context = getContext({ withManager: true, withGraph: false });
		const result = await queryGraphTool.handler(
			{ query: 'MATCH (n) RETURN n', queryType: 'cypher', limit: 10 },
			context
		);

		expect(result.success).toBe(false);
		expect(result.message).toContain('Knowledge graph backend is not connected');
	});

	it('should handle backend error', async () => {
		const errorGraph = {
			query: vi.fn().mockRejectedValue(new Error('Cypher syntax error')),
		};
		const context = {
			toolName: 'query_graph',
			startTime: Date.now(),
			sessionId: 'test-session',
			metadata: {},
			services: {
				knowledgeGraphManager: {
					getGraph: vi.fn().mockReturnValue(errorGraph),
					getBackendType: vi.fn().mockReturnValue('neo4j'),
				} as any,
			},
		};

		const result = await queryGraphTool.handler(
			{ query: 'INVALID CYPHER QUERY', queryType: 'cypher', limit: 10 },
			context
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Cypher syntax error');
	});

	it('should handle complex cypher query with parameters', async () => {
		const context = getContext({ withManager: true, withGraph: true });
		const complexQuery = `
			MATCH (f:Function)-[r:DEPENDS_ON]->(c:Class)
			WHERE f.language = $lang AND r.strength > $minStrength
			RETURN f, r, c
			ORDER BY r.strength DESC
		`;
		const parameters = { lang: 'typescript', minStrength: 0.5 };

		const result = await queryGraphTool.handler(
			{
				query: complexQuery,
				queryType: 'cypher',
				parameters,
				limit: 50,
			},
			context
		);

		expect(result.success).toBe(true);
		expect(mockGraph.query).toHaveBeenCalledWith({
			type: 'cypher',
			query: complexQuery.trim(),
			parameters,
			limit: 50,
		});
	});

	it('should trim whitespace from query string', async () => {
		const context = getContext({ withManager: true, withGraph: true });
		const result = await queryGraphTool.handler(
			{ query: '  MATCH (n) RETURN n  ', queryType: 'cypher' },
			context
		);

		expect(result.success).toBe(true);
		// Verify trimmed value was used
		expect(mockGraph.query).toHaveBeenCalledWith({
			type: 'cypher',
			query: 'MATCH (n) RETURN n',
			parameters: {},
			limit: 100,
		});
	});

	it('should handle structured query parameters for node search', async () => {
		const context = getContext({ withManager: true, withGraph: true });
		const result = await queryGraphTool.handler(
			{
				query: 'properties: {name: "testFunction"}',
				queryType: 'node',
				parameters: { labels: ['Function'] },
			},
			context
		);

		expect(result.success).toBe(true);
		expect(mockGraph.query).toHaveBeenCalledWith({
			type: 'node',
			pattern: {},
			parameters: { labels: ['Function'] },
			limit: 100,
		});
	});

	it('should reject cypher queries for in-memory backend', async () => {
		const context = getContext({
			withManager: true,
			withGraph: true,
			backendType: 'in-memory',
		});

		const result = await queryGraphTool.handler(
			{
				query: 'MATCH (n) RETURN n',
				queryType: 'cypher',
				limit: 10,
			},
			context
		);

		expect(result.success).toBe(false);
		expect(result.message).toContain('Cypher queries require Neo4j backend');
		expect(result.message).toContain('Current backend: in-memory');
		expect(result.alternatives).toEqual(['node', 'edge', 'path']);
		expect(result.results).toBeNull();
	});

	it('should allow cypher queries for neo4j backend', async () => {
		const context = getContext({
			withManager: true,
			withGraph: true,
			backendType: 'neo4j',
		});

		const result = await queryGraphTool.handler(
			{
				query: 'MATCH (n:Function) RETURN n',
				queryType: 'cypher',
				limit: 10,
			},
			context
		);

		expect(result.success).toBe(true);
		expect(result.message).toBe('Query executed');
		expect(mockGraph.query).toHaveBeenCalledWith({
			type: 'cypher',
			query: 'MATCH (n:Function) RETURN n',
			parameters: {},
			limit: 10,
		});
	});
});
