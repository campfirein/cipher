import { AwsService } from '../aws.js';
import { MCPManager } from '../../../../mcp/manager.js';
import { ContextManager } from '../../messages/manager.js';
import { UnifiedToolManager } from '../../../tools/unified-tool-manager.js';

// Mock dependencies
const mockMCPManager = {} as MCPManager;
const mockContextManager = {} as ContextManager;
const mockUnifiedToolManager = {} as UnifiedToolManager;

describe('AwsService', () => {
	it('should instantiate in proxy mode with OpenAI-compatible config', () => {
		const config = {
			provider: 'aws',
			model: 'test-model',
			apiKey: 'test-key',
			baseURL: 'https://proxy.example.com/v1',
		};
		const service = new AwsService(
			config,
			mockMCPManager,
			mockContextManager,
			5,
			mockUnifiedToolManager
		);
		expect(service).toBeDefined();
		// @ts-expect-error: private property
		expect(service.mode).toBe('proxy');
	});

	it('should instantiate in native mode with Bedrock config', () => {
		const config = {
			provider: 'aws',
			model: 'test-model',
			region: 'us-east-1',
			accessKeyId: 'AKIA...',
			secretAccessKey: 'SECRET...',
		};
		const service = new AwsService(
			config,
			mockMCPManager,
			mockContextManager,
			5,
			mockUnifiedToolManager
		);
		expect(service).toBeDefined();
		// @ts-expect-error: private property
		expect(service.mode).toBe('native');
	});

	it('should throw if not properly configured', async () => {
		const config = { provider: 'aws', model: 'test-model' };
		const service = new AwsService(
			config,
			mockMCPManager,
			mockContextManager,
			5,
			mockUnifiedToolManager
		);
		await expect(service.generate('test')).rejects.toThrow();
	});

	// Add more tests with SDK mocks for generate() if needed
});
