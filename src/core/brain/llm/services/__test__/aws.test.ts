import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AwsService } from '../aws.js';
import { MCPManager } from '../../../../mcp/manager.js';
import { ContextManager } from '../../messages/manager.js';
import { UnifiedToolManager } from '../../../tools/unified-tool-manager.js';
import {
	BedrockRuntimeClient,
	InvokeModelCommand,
	InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';

// Mock AWS SDK
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
	BedrockRuntimeClient: vi.fn(),
	InvokeModelCommand: vi.fn(),
	InvokeModelWithResponseStreamCommand: vi.fn(),
}));

describe('AwsService', () => {
	let awsService: AwsService;
	let mockMcpManager: MCPManager;
	let mockContextManager: ContextManager;
	let mockToolManager: UnifiedToolManager;
	let mockBedrockClient: any;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
		process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
		process.env.AWS_DEFAULT_REGION = 'us-east-1';

		mockMcpManager = {} as MCPManager;
		mockContextManager = {
			addUserMessage: vi.fn(),
			addAssistantMessage: vi.fn(),
			getAllFormattedMessages: vi.fn().mockResolvedValue([]),
			getSystemPrompt: vi.fn().mockResolvedValue('Test system prompt'),
		} as unknown as ContextManager;
		mockToolManager = {
			getToolsForProvider: vi.fn().mockResolvedValue([]),
			getAllTools: vi.fn().mockResolvedValue({}),
			executeTool: vi.fn().mockResolvedValue('tool result'),
		} as unknown as UnifiedToolManager;
		mockBedrockClient = { send: vi.fn() };
		(BedrockRuntimeClient as any).mockImplementation(() => mockBedrockClient);
		awsService = new AwsService(
			'anthropic.claude-3-sonnet-20240229-v1:0',
			mockMcpManager,
			mockContextManager,
			mockToolManager,
			10,
			{ region: 'us-east-1', accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' }
		);
	});

	afterEach(() => {
		delete process.env.AWS_ACCESS_KEY_ID;
		delete process.env.AWS_SECRET_ACCESS_KEY;
		delete process.env.AWS_DEFAULT_REGION;
	});

	describe('constructor', () => {
		it('should initialize with provided configuration', () => {
			expect(BedrockRuntimeClient).toHaveBeenCalledWith({
				region: 'us-east-1',
				credentials: {
					accessKeyId: 'test-access-key',
					secretAccessKey: 'test-secret-key',
				},
			});
		});
	});

	describe('generate', () => {
		it('should call addUserMessage and return string', async () => {
			mockBedrockClient.send.mockResolvedValue({
				body: Buffer.from(JSON.stringify({ content: [{ type: 'text', text: 'response' }] })),
			});
			const result = await awsService.generate('hello');
			expect(mockContextManager.addUserMessage).toHaveBeenCalledWith('hello', undefined);
			expect(typeof result).toBe('string');
			expect(result).toBe('response');
		});
	});

	describe('directGenerate', () => {
		it('should return string response', async () => {
			mockBedrockClient.send.mockResolvedValue({
				body: Buffer.from(JSON.stringify({ content: [{ type: 'text', text: 'direct response' }] })),
			});
			const result = await awsService.directGenerate('hi');
			expect(typeof result).toBe('string');
			expect(result).toBe('direct response');
		});
	});
});
