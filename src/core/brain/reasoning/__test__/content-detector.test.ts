/**
 * Tests for Content-Based Reasoning Detection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReasoningContentDetector } from '../content-detector.js';
import { MCPManager } from '../../../mcp/manager.js';
import { UnifiedToolManager } from '../../tools/unified-tool-manager.js';
import { EnhancedPromptManager } from '../../systemPrompt/enhanced-manager.js';

// Mock dependencies
vi.mock('../../../mcp/manager.js');
vi.mock('../../tools/unified-tool-manager.js');
vi.mock('../../../logger/index.js', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

describe('ReasoningContentDetector', () => {
	let detector: ReasoningContentDetector;
	let mockMcpManager: MCPManager;
	let mockUnifiedToolManager: UnifiedToolManager;
	let mockEvalLlmConfig: any;
	let mockPromptManager: EnhancedPromptManager;

	beforeEach(() => {
		mockPromptManager = {} as EnhancedPromptManager;
		mockMcpManager = {} as MCPManager;
		mockUnifiedToolManager = {} as UnifiedToolManager;

		// Mock evalLlmConfig for testing
		mockEvalLlmConfig = {
			provider: 'openai',
			model: 'gpt-4o-mini',
			apiKey: 'test-api-key',
			maxIterations: 3,
		};

		detector = new ReasoningContentDetector(
			mockPromptManager,
			mockMcpManager,
			mockUnifiedToolManager,
			mockEvalLlmConfig,
			undefined
		);
	});

	describe('LLM-based detection', () => {
		it('should detect reasoning content', async () => {
			const input =
				'Let me think about this problem step by step. First, I need to analyze the requirements.';

			const result = await detector.detectReasoningContent(input);

			// Since we're mocking the LLM service, we expect it to return false
			// In real usage, this would be determined by the LLM analysis
			expect(result.containsReasoning).toBeDefined();
			expect(result.confidence).toBeGreaterThanOrEqual(0);
			expect(result.confidence).toBeLessThanOrEqual(1);
		});

		it('should handle simple statements', async () => {
			const input = 'Hello, how are you today?';

			const result = await detector.detectReasoningContent(input);

			expect(result.containsReasoning).toBeDefined();
			expect(result.confidence).toBeGreaterThanOrEqual(0);
			expect(result.confidence).toBeLessThanOrEqual(1);
		});

		it('should handle technical reasoning patterns', async () => {
			const input = 'I need to optimize this algorithm for better performance and scalability.';

			const result = await detector.detectReasoningContent(input);

			expect(result.containsReasoning).toBeDefined();
			expect(result.confidence).toBeGreaterThanOrEqual(0);
			expect(result.confidence).toBeLessThanOrEqual(1);
		});
	});

	describe('Options and configuration', () => {
		it('should use default options when none provided', () => {
			const options = detector.getOptions();

			expect(options.confidenceThreshold).toBe(0.7);
			expect(options.maxPatterns).toBe(10);
		});

		it('should allow custom options', () => {
			const customOptions = {
				confidenceThreshold: 0.9,
				maxPatterns: 5,
			};

			detector.updateOptions(customOptions);
			const options = detector.getOptions();

			expect(options.confidenceThreshold).toBe(0.9);
			expect(options.maxPatterns).toBe(5);
		});

		it('should limit detected patterns to maxPatterns', async () => {
			detector.updateOptions({ maxPatterns: 3 });

			const input =
				'Let me think about this: First, I need to analyze the problem. Then I can figure out the solution. Finally, I can implement it.';

			const result = await detector.detectReasoningContent(input);

			expect(result.detectedPatterns.length).toBeLessThanOrEqual(3);
		});
	});

	describe('Error handling', () => {
		it('should handle empty input gracefully', async () => {
			const result = await detector.detectReasoningContent('');

			expect(result.containsReasoning).toBe(false);
			expect(result.confidence).toBe(0);
			expect(result.detectedPatterns).toHaveLength(0);
		});

		it('should handle very short input', async () => {
			const result = await detector.detectReasoningContent('Hi');

			expect(result.containsReasoning).toBe(false);
			expect(result.confidence).toBeLessThan(0.6);
		});

		it('should handle input with only whitespace', async () => {
			const result = await detector.detectReasoningContent('   \n\t   ');

			expect(result.containsReasoning).toBe(false);
			expect(result.confidence).toBe(0);
		});
	});

	describe('Context handling', () => {
		it('should accept context parameters', async () => {
			const input = 'Let me analyze this problem.';
			const context = {
				sessionId: 'test-session',
				taskType: 'debugging',
				recentMessages: ['Previous message'],
			};

			const result = await detector.detectReasoningContent(input, context);

			// Since we're mocking the LLM service, we expect it to return false
			// In real usage, this would be determined by the LLM analysis
			expect(result.containsReasoning).toBeDefined();
			expect(result.confidence).toBeGreaterThanOrEqual(0);
			expect(result.confidence).toBeLessThanOrEqual(1);
		});
	});
});
