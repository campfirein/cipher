import { AwsService } from '../aws.js';
import { MCPManager } from '../../../../mcp/manager.js';
import { ContextManager } from '../../messages/manager.js';
import { UnifiedToolManager } from '../../../tools/unified-tool-manager.js';

const mockMCPManager = {} as MCPManager;
const mockContextManager = {} as ContextManager;
const mockUnifiedToolManager = {} as UnifiedToolManager;

describe('AwsService Integration', () => {
	const userInput = 'Hello, AWS Bedrock!';

	it.skip('should call AWS Bedrock in native mode (requires real credentials)', async () => {
		if (!process.env.AWS_REGION || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.AWS_BEDROCK_MODEL_ID) {
			console.warn('AWS credentials or model ID not set. Skipping test.');
			return;
		}
		const config = {
			provider: 'aws',
			model: process.env.AWS_BEDROCK_MODEL_ID,
			region: process.env.AWS_REGION,
			accessKeyId: process.env.AWS_ACCESS_KEY_ID,
			secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
		};
		const service = new AwsService(config, mockMCPManager, mockContextManager, 1, mockUnifiedToolManager);
		const response = await service.generate(userInput);
		expect(typeof response).toBe('string');
	});

	it.skip('should call AWS Bedrock via OpenAI-compatible proxy (requires proxy setup)', async () => {
		if (!process.env.AWS_PROXY_BASE_URL || !process.env.AWS_PROXY_API_KEY || !process.env.AWS_PROXY_MODEL) {
			console.warn('AWS proxy config not set. Skipping test.');
			return;
		}
		const config = {
			provider: 'aws',
			model: process.env.AWS_PROXY_MODEL,
			apiKey: process.env.AWS_PROXY_API_KEY,
			baseURL: process.env.AWS_PROXY_BASE_URL,
		};
		const service = new AwsService(config, mockMCPManager, mockContextManager, 1, mockUnifiedToolManager);
		const response = await service.generate(userInput);
		expect(typeof response).toBe('string');
	});
}); 