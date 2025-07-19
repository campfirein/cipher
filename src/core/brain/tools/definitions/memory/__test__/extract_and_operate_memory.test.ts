import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractAndOperateMemoryTool } from '../extract_and_operate_memory.js';
import { InternalToolContext } from '../../../types.js';

// Mock logger
vi.mock('../../../../logger/index.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

describe('extractAndOperateMemoryTool - Retrieved Results Filtering', () => {
	let mockContext: InternalToolContext;
	let mockEmbedder: any;
	let mockVectorStore: any;
	let mockVectorStoreManager: any;
	let mockLlmService: any;

	beforeEach(() => {
		// Mock embedder
		mockEmbedder = {
			embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4, 0.5]),
		};

		// Mock vector store
		mockVectorStore = {
			search: vi.fn().mockResolvedValue([]),
			insert: vi.fn().mockResolvedValue(true),
			update: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined),
		};

		// Mock vector store manager
		mockVectorStoreManager = {
			getVectorStore: vi.fn().mockResolvedValue(mockVectorStore),
			getStore: vi.fn().mockResolvedValue(mockVectorStore),
		};

		// Mock LLM service
		mockLlmService = {
			generateText: vi
				.fn()
				.mockResolvedValue('{"decision": "NONE", "reasoning": "Test reasoning"}'),
		};

		// Mock context
		mockContext = {
			services: {
				embeddingManager: {
					getEmbedder: vi.fn().mockReturnValue(mockEmbedder),
				} as any,
				vectorStoreManager: mockVectorStoreManager,
				llmService: mockLlmService,
			},
			toolName: 'cipher_extract_and_operate_memory',
			startTime: Date.now(),
			sessionId: 'test-session',
			metadata: {},
		};
	});

	describe('Retrieved Results Pattern Detection', () => {
		it('should skip cipher_memory_search tool results', async () => {
			const interactionData = [
				'User: Show me about React hooks',
				'Assistant: Here is information about React hooks',
				'Tool Call: cipher_memory_search',
				'Tool Response: cipher_memory_search: Found 3 relevant memories about React hooks\nMemory 1: React hooks are functions that let you use state\nMemory 2: useEffect is used for side effects',
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionData,
					context: 'Learning about React hooks',
				},
				mockContext
			);

			expect(result.success).toBe(true);

			// Verify that tool responses with retrieved results are filtered out
			const toolResponseFacts = result.extraction.facts.filter(
				(fact: any) =>
					fact.preview.includes('cipher_memory_search') || fact.preview.includes('Tool Response')
			);
			expect(toolResponseFacts).toHaveLength(0);

			// Verify correct extraction counts
			expect(result.extraction.extracted).toBe(2); // User + Assistant only
			expect(result.extraction.skipped).toBe(2); // Tool Call + Tool Response skipped

			// Verify only genuine interaction content is preserved
			expect(result.extraction.facts).toHaveLength(2);
			expect(result.extraction.facts[0].preview).toBe('User: Show me about React hooks');
			expect(result.extraction.facts[1].preview).toBe(
				'Assistant: Here is information about React hooks'
			);
		});

		it('should skip search_reasoning_patterns tool results', async () => {
			const interactionWithRetrievedResults = [
				'User: Can you help me with something?',
				'Assistant: I would be happy to help you.',
				'search_reasoning_patterns: Retrieved 5 patterns\nPattern 1: Binary search implementation\nPattern 2: Depth-first search approach',
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithRetrievedResults,
					context: 'Learning search algorithms',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.memory).toHaveLength(0);
			expect(result.extraction.skipped).toBeGreaterThan(0);
		});

		it('should skip query_graph tool results', async () => {
			const interactionWithRetrievedResults = [
				'User: What is the relationship between these things?',
				'Assistant: Here is the relationship information',
				'query_graph: Found 2 nodes and 3 edges\nNodes: React, Redux\nEdges: React->Redux (uses), Redux->React (manages state)',
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithRetrievedResults,
					context: 'Understanding React-Redux relationship',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.memory).toHaveLength(0);
			expect(result.extraction.skipped).toBeGreaterThan(0);
		});

		it('should skip enhanced_search tool results', async () => {
			const interactionWithRetrievedResults = [
				'User: Find information about something',
				'Assistant: Here is information about that topic',
				'enhanced_search: Search completed successfully\nRetrieved 4 relevant documents\nDocument 1: TypeScript generics allow you to create reusable components',
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithRetrievedResults,
					context: 'Learning TypeScript generics',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.memory).toHaveLength(0);
			expect(result.extraction.skipped).toBeGreaterThan(0);
		});

		it('should skip results with retrieved/found/matches patterns', async () => {
			const interactionWithRetrievedResults = [
				'User: Tell me about something',
				'Assistant: I can tell you about that',
				'Retrieved: 6 async/await patterns found\nMatches: async function declarations, await expressions\nFound: Error handling patterns in async code',
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithRetrievedResults,
					context: 'Learning async/await patterns',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.memory).toHaveLength(0);
			expect(result.extraction.skipped).toBeGreaterThan(0);
		});

		it('should skip knowledge/reflection results', async () => {
			const interactionWithRetrievedResults = [
				'User: What are the best practices?',
				'Assistant: Here are the best practices',
				'Knowledge results: 8 best practices retrieved\nReflection results: Analysis of React patterns\nReasoning patterns: Component composition strategies',
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithRetrievedResults,
					context: 'Learning React best practices',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.memory).toHaveLength(0);
			expect(result.extraction.skipped).toBeGreaterThan(0);
		});

		it('should skip graph search results with nodes/edges', async () => {
			const interactionWithRetrievedResults = [
				'User: Show me something',
				'Assistant: Here is what you asked for',
				'Graph search: Query executed\nNodes: 15 packages found\nEdges: 23 dependencies mapped\nTotalcount: 38 relationships\nExecutiontime: 120ms',
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithRetrievedResults,
					context: 'Analyzing project dependencies',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.memory).toHaveLength(0);
			expect(result.extraction.skipped).toBeGreaterThan(0);
		});

		it('should skip reflection memory patterns', async () => {
			const interactionWithRetrievedResults = [
				'User: Look at this',
				'Assistant: I looked at it',
				'Observation: Function is well-structured\nAction: No changes needed\nThought: Pattern follows conventions\nConclusion: Code is maintainable\nReflection: Good practices applied',
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithRetrievedResults,
					context: 'Code pattern analysis',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.memory).toHaveLength(0);
			expect(result.extraction.skipped).toBeGreaterThan(0);
		});

		it('should skip metadata patterns (id, timestamp, similarity)', async () => {
			const interactionWithRetrievedResults = [
				'User: Find similar patterns',
				'Assistant: Here are similar patterns',
				'Id: pattern-123\nTimestamp: 2024-01-15T10:30:00Z\nSimilarity: 0.89\nSource: codebase-main\nMemorytype: pattern-match',
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithRetrievedResults,
					context: 'Finding similar patterns',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.memory).toHaveLength(0);
			expect(result.extraction.skipped).toBeGreaterThan(0);
		});

		it('should skip system status messages', async () => {
			const interactionWithRetrievedResults = [
				'User: Do something',
				'Assistant: I did it',
				"Message: 'query executed'\nSuccess: true\nTotalresults: 5\nSearchtime: 250ms\nEmbeddingtime: 50ms",
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithRetrievedResults,
					context: 'Running search query',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.memory).toHaveLength(0);
			expect(result.extraction.skipped).toBeGreaterThan(0);
		});
	});

	describe('Edge Cases and Bypasses', () => {
		it('should handle mixed content (retrieved + genuine)', async () => {
			const interactionWithMixedContent = [
				'User: How do I use something?',
				'Assistant: This is a powerful feature that allows you to use various capabilities.',
				'cipher_memory_search: Found 2 memories about React hooks\nMemory 1: useState hook for state management',
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithMixedContent,
					context: 'Learning React hooks',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			// Should have some facts (from assistant response) but skip retrieved results
			expect(result.extraction.skipped).toBeGreaterThan(0);
		});

		it('should handle case-insensitive pattern matching', async () => {
			const interactionWithCaseVariations = [
				'User: Tell me about things',
				'Assistant: Here are the things',
				'CIPHER_MEMORY_SEARCH: Results found\nRETRIEVED: 3 patterns\nKNOWLEDGE RESULTS: Pattern analysis complete',
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithCaseVariations,
					context: 'Pattern search',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.memory).toHaveLength(0);
			expect(result.extraction.skipped).toBeGreaterThan(0);
		});

		it('should handle empty or null content gracefully', async () => {
			const interactionWithEmptyContent = [
				'User: Test empty content',
				'Assistant: Response with empty tool output',
				'', // Empty string
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithEmptyContent,
					context: 'Testing empty content',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			// Should not crash on empty/null content
		});

		it('should handle non-string content types', async () => {
			const interactionWithNonStringContent = [
				'User: Test non-string content',
				'Assistant: Response with non-string tool output',
				'cipher_memory_search: results', // This should be filtered as retrieved result
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithNonStringContent,
					context: 'Testing non-string content',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			// Should handle non-string content gracefully
		});
	});

	describe('Performance and Stress Tests', () => {
		it('should handle large numbers of retrieved results efficiently', async () => {
			const toolInvocations = [];
			for (let i = 0; i < 100; i++) {
				toolInvocations.push(
					`cipher_memory_search: Retrieved result ${i}\nFound: ${i} items\nNodes: ${i} nodes processed`
				);
			}

			const interactionWithManyResults = [
				'User: Tell me about things',
				'Assistant: Here are the things',
				...toolInvocations,
			];

			const startTime = Date.now();
			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithManyResults,
					context: 'Large search test',
				},
				mockContext
			);
			const endTime = Date.now();

			expect(result.success).toBe(true);
			expect(result.memory).toHaveLength(0);
			expect(result.extraction.skipped).toBeGreaterThan(0);
			expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
		});
	});

	describe('Integration with Significance Filtering', () => {
		it('should apply retrieved results filter before significance filter', async () => {
			const interactionWithSignificantRetrieved = [
				'User: Tell me about concepts',
				'Assistant: Here are the concepts',
				'cipher_memory_search: Retrieved comprehensive programming concepts\nObject-oriented programming principles\nFunctional programming paradigms\nDesign patterns and best practices',
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithSignificantRetrieved,
					context: 'Learning programming concepts',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			// Even though content is significant, it should be skipped because it's retrieved
			expect(result.memory).toHaveLength(0);
			expect(result.extraction.skipped).toBeGreaterThan(0);
		});
	});

	describe('Error Handling', () => {
		it('should handle malformed tool invocations gracefully', async () => {
			const interactionWithMalformedTool = [
				'User: Test malformed tool',
				'Assistant: Testing malformed tool invocation',
				'cipher_memory_search: Some result',
				'retrieved: Some other result',
			];

			const result = await extractAndOperateMemoryTool.handler(
				{
					interaction: interactionWithMalformedTool,
					context: 'Testing malformed tool',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			// Should handle malformed tools gracefully
		});
	});
});
