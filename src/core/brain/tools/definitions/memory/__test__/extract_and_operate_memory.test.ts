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
      generateText: vi.fn().mockResolvedValue('{"decision": "NONE", "reasoning": "Test reasoning"}'),
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

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionData,
        context: 'Learning about React hooks',
      }, mockContext);

      expect(result.success).toBe(true);
      
      // Verify that tool responses with retrieved results are filtered out
      const toolResponseFacts = result.extraction.facts.filter((fact: any) => 
        fact.preview.includes('cipher_memory_search') || 
        fact.preview.includes('Tool Response')
      );
      expect(toolResponseFacts).toHaveLength(0);
      
      // Verify correct extraction counts
      expect(result.extraction.extracted).toBe(2); // User + Assistant only
      expect(result.extraction.skipped).toBe(2); // Tool Call + Tool Response skipped
      
      // Verify only genuine interaction content is preserved
      expect(result.extraction.facts).toHaveLength(2);
      expect(result.extraction.facts[0].preview).toBe('User: Show me about React hooks');
      expect(result.extraction.facts[1].preview).toBe('Assistant: Here is information about React hooks');
    });

    it('should skip search_reasoning_patterns tool results', async () => {
      const interactionWithRetrievedResults = {
        userInput: 'How do I implement a search algorithm?',
        assistantResponse: 'Here are search algorithm patterns',
        toolInvocations: [
          {
            toolName: 'search_reasoning_patterns',
            input: { query: 'search algorithms' },
            output: 'search_reasoning_patterns: Retrieved 5 patterns\nPattern 1: Binary search implementation\nPattern 2: Depth-first search approach',
          },
        ],
        timestamp: Date.now(),
      };

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithRetrievedResults,
        context: 'Learning search algorithms',
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.addedMemories).toHaveLength(0);
      expect(result.data.skippedFacts).toBeGreaterThan(0);
    });

    it('should skip query_graph tool results', async () => {
      const interactionWithRetrievedResults = {
        userInput: 'What is the relationship between React and Redux?',
        assistantResponse: 'Here is the relationship information',
        toolInvocations: [
          {
            toolName: 'query_graph',
            input: { query: 'React Redux relationship' },
            output: 'query_graph: Found 2 nodes and 3 edges\nNodes: React, Redux\nEdges: React->Redux (uses), Redux->React (manages state)',
          },
        ],
        timestamp: Date.now(),
      };

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithRetrievedResults,
        context: 'Understanding React-Redux relationship',
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.addedMemories).toHaveLength(0);
      expect(result.data.skippedFacts).toBeGreaterThan(0);
    });

    it('should skip enhanced_search tool results', async () => {
      const interactionWithRetrievedResults = {
        userInput: 'Find information about TypeScript generics',
        assistantResponse: 'Here is information about TypeScript generics',
        toolInvocations: [
          {
            toolName: 'enhanced_search',
            input: { query: 'TypeScript generics' },
            output: 'enhanced_search: Search completed successfully\nRetrieved 4 relevant documents\nDocument 1: TypeScript generics allow you to create reusable components',
          },
        ],
        timestamp: Date.now(),
      };

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithRetrievedResults,
        context: 'Learning TypeScript generics',
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.addedMemories).toHaveLength(0);
      expect(result.data.skippedFacts).toBeGreaterThan(0);
    });

    it('should skip results with retrieved/found/matches patterns', async () => {
      const interactionWithRetrievedResults = {
        userInput: 'Search for async/await patterns',
        assistantResponse: 'Here are async/await patterns',
        toolInvocations: [
          {
            toolName: 'search_tool',
            input: { query: 'async await' },
            output: 'Retrieved: 6 async/await patterns found\nMatches: async function declarations, await expressions\nFound: Error handling patterns in async code',
          },
        ],
        timestamp: Date.now(),
      };

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithRetrievedResults,
        context: 'Learning async/await patterns',
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.addedMemories).toHaveLength(0);
      expect(result.data.skippedFacts).toBeGreaterThan(0);
    });

    it('should skip knowledge/reflection results', async () => {
      const interactionWithRetrievedResults = {
        userInput: 'What are the best practices for React?',
        assistantResponse: 'Here are React best practices',
        toolInvocations: [
          {
            toolName: 'knowledge_search',
            input: { query: 'React best practices' },
            output: 'Knowledge results: 8 best practices retrieved\nReflection results: Analysis of React patterns\nReasoning patterns: Component composition strategies',
          },
        ],
        timestamp: Date.now(),
      };

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithRetrievedResults,
        context: 'Learning React best practices',
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.addedMemories).toHaveLength(0);
      expect(result.data.skippedFacts).toBeGreaterThan(0);
    });

    it('should skip graph search results with nodes/edges', async () => {
      const interactionWithRetrievedResults = {
        userInput: 'Show me the dependency graph for this project',
        assistantResponse: 'Here is the dependency graph',
        toolInvocations: [
          {
            toolName: 'graph_search',
            input: { query: 'dependencies' },
            output: 'Graph search: Query executed\nNodes: 15 packages found\nEdges: 23 dependencies mapped\nTotalcount: 38 relationships\nExecutiontime: 120ms',
          },
        ],
        timestamp: Date.now(),
      };

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithRetrievedResults,
        context: 'Analyzing project dependencies',
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.addedMemories).toHaveLength(0);
      expect(result.data.skippedFacts).toBeGreaterThan(0);
    });

    it('should skip reflection memory patterns', async () => {
      const interactionWithRetrievedResults = {
        userInput: 'Analyze this code pattern',
        assistantResponse: 'Here is the analysis',
        toolInvocations: [
          {
            toolName: 'reflection_tool',
            input: { code: 'function example() {}' },
            output: 'Observation: Function is well-structured\nAction: No changes needed\nThought: Pattern follows conventions\nConclusion: Code is maintainable\nReflection: Good practices applied',
          },
        ],
        timestamp: Date.now(),
      };

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithRetrievedResults,
        context: 'Code pattern analysis',
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.addedMemories).toHaveLength(0);
      expect(result.data.skippedFacts).toBeGreaterThan(0);
    });

    it('should skip metadata patterns (id, timestamp, similarity)', async () => {
      const interactionWithRetrievedResults = {
        userInput: 'Find similar code patterns',
        assistantResponse: 'Here are similar patterns',
        toolInvocations: [
          {
            toolName: 'similarity_search',
            input: { pattern: 'async function' },
            output: 'Id: pattern-123\nTimestamp: 2024-01-15T10:30:00Z\nSimilarity: 0.89\nSource: codebase-main\nMemorytype: pattern-match',
          },
        ],
        timestamp: Date.now(),
      };

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithRetrievedResults,
        context: 'Finding similar patterns',
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.addedMemories).toHaveLength(0);
      expect(result.data.skippedFacts).toBeGreaterThan(0);
    });

    it('should skip system status messages', async () => {
      const interactionWithRetrievedResults = {
        userInput: 'Run the search query',
        assistantResponse: 'Search completed',
        toolInvocations: [
          {
            toolName: 'system_search',
            input: { query: 'test' },
            output: 'Message: \'query executed\'\nSuccess: true\nTotalresults: 5\nSearchtime: 250ms\nEmbeddingtime: 50ms',
          },
        ],
        timestamp: Date.now(),
      };

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithRetrievedResults,
        context: 'Running search query',
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.addedMemories).toHaveLength(0);
      expect(result.data.skippedFacts).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases and Bypasses', () => {
    it('should handle mixed content (retrieved + genuine)', async () => {
      const interactionWithMixedContent = {
        userInput: 'How do I use React hooks?',
        assistantResponse: 'React hooks are a powerful feature that allows you to use state and other React features in functional components.',
        toolInvocations: [
          {
            toolName: 'cipher_memory_search',
            input: { query: 'React hooks' },
            output: 'cipher_memory_search: Found 2 memories about React hooks\nMemory 1: useState hook for state management',
          },
        ],
        timestamp: Date.now(),
      };

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithMixedContent,
        context: 'Learning React hooks',
      }, mockContext);

      expect(result.success).toBe(true);
      // Should have some facts (from assistant response) but skip retrieved results
      expect(result.data.skippedFacts).toBeGreaterThan(0);
    });

    it('should handle case-insensitive pattern matching', async () => {
      const interactionWithCaseVariations = {
        userInput: 'Search for patterns',
        assistantResponse: 'Here are the patterns',
        toolInvocations: [
          {
            toolName: 'search_tool',
            input: { query: 'patterns' },
            output: 'CIPHER_MEMORY_SEARCH: Results found\nRETRIEVED: 3 patterns\nKNOWLEDGE RESULTS: Pattern analysis complete',
          },
        ],
        timestamp: Date.now(),
      };

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithCaseVariations,
        context: 'Pattern search',
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.addedMemories).toHaveLength(0);
      expect(result.data.skippedFacts).toBeGreaterThan(0);
    });

    it('should handle empty or null content gracefully', async () => {
      const interactionWithEmptyContent = {
        userInput: 'Test empty content',
        assistantResponse: 'Response with empty tool output',
        toolInvocations: [
          {
            toolName: 'search_tool',
            input: { query: 'test' },
            output: null,
          },
          {
            toolName: 'another_tool',
            input: { query: 'test' },
            output: '',
          },
        ],
        timestamp: Date.now(),
      };

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithEmptyContent,
        context: 'Testing empty content',
      }, mockContext);

      expect(result.success).toBe(true);
      // Should not crash on empty/null content
    });

    it('should handle non-string content types', async () => {
      const interactionWithNonStringContent = {
        userInput: 'Test non-string content',
        assistantResponse: 'Response with non-string tool output',
        toolInvocations: [
          {
            toolName: 'search_tool',
            input: { query: 'test' },
            output: { type: 'object', data: 'cipher_memory_search: results' },
          },
        ],
        timestamp: Date.now(),
      };

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithNonStringContent,
        context: 'Testing non-string content',
      }, mockContext);

      expect(result.success).toBe(true);
      // Should handle non-string content gracefully
    });
  });

  describe('Performance and Stress Tests', () => {
    it('should handle large numbers of retrieved results efficiently', async () => {
      const toolInvocations = [];
      for (let i = 0; i < 100; i++) {
        toolInvocations.push({
          toolName: `search_tool_${i}`,
          input: { query: `test ${i}` },
          output: `cipher_memory_search: Retrieved result ${i}\nFound: ${i} items\nNodes: ${i} nodes processed`,
        }, mockContext);
      }

      const interactionWithManyResults = {
        userInput: 'Large search test',
        assistantResponse: 'Processing large search results',
        toolInvocations,
        timestamp: Date.now(),
      };

      const startTime = Date.now();
      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithManyResults,
        context: 'Large search test',
      }, mockContext);
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(result.data.addedMemories).toHaveLength(0);
      expect(result.data.skippedFacts).toBeGreaterThan(0);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });

  describe('Integration with Significance Filtering', () => {
    it('should apply retrieved results filter before significance filter', async () => {
      const interactionWithSignificantRetrieved = {
        userInput: 'Search for important programming concepts',
        assistantResponse: 'Here are important programming concepts',
        toolInvocations: [
          {
            toolName: 'concept_search',
            input: { query: 'programming concepts' },
            output: 'cipher_memory_search: Retrieved comprehensive programming concepts\nObject-oriented programming principles\nFunctional programming paradigms\nDesign patterns and best practices',
          },
        ],
        timestamp: Date.now(),
      };

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithSignificantRetrieved,
        context: 'Learning programming concepts',
      }, mockContext);

      expect(result.success).toBe(true);
      // Even though content is significant, it should be skipped because it's retrieved
      expect(result.data.addedMemories).toHaveLength(0);
      expect(result.data.skippedFacts).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed tool invocations gracefully', async () => {
      const interactionWithMalformedTool = {
        userInput: 'Test malformed tool',
        assistantResponse: 'Testing malformed tool invocation',
        toolInvocations: [
          {
            // Missing toolName
            input: { query: 'test' },
            output: 'cipher_memory_search: Some result',
          },
          {
            toolName: 'valid_tool',
            // Missing input
            output: 'retrieved: Some other result',
          },
        ],
        timestamp: Date.now(),
      };

      const result = await extractAndOperateMemoryTool.handler({
        interaction: interactionWithMalformedTool,
        context: 'Testing malformed tool',
      }, mockContext);

      expect(result.success).toBe(true);
      // Should handle malformed tools gracefully
    });
  });
});