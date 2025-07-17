/* eslint-env vitest */
/* global describe, it, expect */
import { AzureService } from '../azure.js';
import { MCPManager } from '../../../../mcp/manager.js';
import { ContextManager } from '../../messages/manager.js';
import { UnifiedToolManager } from '../../../tools/unified-tool-manager.js';

const mockMCPManager = {} as MCPManager;
const mockContextManager = {} as ContextManager;
const mockUnifiedToolManager = {} as UnifiedToolManager;

describe('AzureService Integration', () => {
	const userInput = 'Hello, Azure OpenAI!';

	it.skip('should call Azure OpenAI (requires real credentials)', async () => {
		if (
			!process.env.AZURE_OPENAI_ENDPOINT ||
			!process.env.AZURE_OPENAI_API_KEY ||
			!process.env.AZURE_OPENAI_DEPLOYMENT
		) {
			console.warn('Azure OpenAI credentials or deployment not set. Skipping test.');
			return;
		}
		const config = {
			provider: 'azure',
			model: 'gpt-4',
			endpoint: process.env.AZURE_OPENAI_ENDPOINT,
			apiKey: process.env.AZURE_OPENAI_API_KEY,
			deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT,
		};
		const service = new AzureService(
			config,
			mockMCPManager,
			mockContextManager,
			1,
			mockUnifiedToolManager
		);
		const response = await service.generate(userInput);
		expect(typeof response).toBe('string');
	});
});
