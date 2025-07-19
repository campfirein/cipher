import { describe, it, expect, vi } from 'vitest';
import { createContextManager } from '../factory.js';
import { LLMConfig } from '../../config.js';

// Mock the PromptManager
vi.mock('../../../systemPrompt/manager.js', () => ({
	PromptManager: vi.fn().mockImplementation(() => ({
		getInstruction: vi.fn().mockReturnValue('Test system prompt'),
	})),
}));

describe('Message Factory', () => {
	it('should create context manager with OpenAI provider', async () => {
		const config: LLMConfig = {
			provider: 'openai',
			model: 'gpt-4o-mini',
			apiKey: 'test-key',
		};

		const { PromptManager } = await import('../../../systemPrompt/manager.js');
		const promptManager = new PromptManager();
		const contextManager = createContextManager(config, promptManager);

		expect(contextManager).toBeDefined();
	});

	it('should create context manager with Anthropic provider', async () => {
		const config: LLMConfig = {
			provider: 'anthropic',
			model: 'claude-3-5-sonnet-20241022',
			apiKey: 'test-key',
		};

		const { PromptManager } = await import('../../../systemPrompt/manager.js');
		const promptManager = new PromptManager();
		const contextManager = createContextManager(config, promptManager);

		expect(contextManager).toBeDefined();
	});

	it('should create context manager with Gemini provider', async () => {
		const config: LLMConfig = {
			provider: 'gemini',
			model: 'gemini-pro',
			apiKey: 'test-key',
		};

		const { PromptManager } = await import('../../../systemPrompt/manager.js');
		const promptManager = new PromptManager();
		const contextManager = createContextManager(config, promptManager);

		expect(contextManager).toBeDefined();
	});
});
