import { AzureService } from '../azure.js';
import { MCPManager } from '../../../../mcp/manager.js';
import { ContextManager } from '../../messages/manager.js';
import { UnifiedToolManager } from '../../../tools/unified-tool-manager.js';

// Mock dependencies
const mockMCPManager = {} as MCPManager;
const mockContextManager = {} as ContextManager;
const mockUnifiedToolManager = {} as UnifiedToolManager;

describe('AzureService', () => {
	it('should instantiate with valid config', () => {
		const config = {
			provider: 'azure',
			model: 'test-model',
			endpoint: 'https://azure.example.com',
			apiKey: 'test-key',
			deploymentName: 'test-deployment',
		};
		const service = new AzureService(
			config,
			mockMCPManager,
			mockContextManager,
			5,
			mockUnifiedToolManager
		);
		expect(service).toBeDefined();
	});

	it('should throw if endpoint or apiKey is missing', () => {
		const config = {
			provider: 'azure',
			model: 'test-model',
			deploymentName: 'test-deployment',
		};
		expect(
			() => new AzureService(config, mockMCPManager, mockContextManager, 5, mockUnifiedToolManager)
		).toThrow();
	});

	it('should throw if deploymentName is missing on generate', async () => {
		const config = {
			provider: 'azure',
			model: 'test-model',
			endpoint: 'https://azure.example.com',
			apiKey: 'test-key',
		};
		const service = new AzureService(
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
