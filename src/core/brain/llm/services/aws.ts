import { ILLMService, LLMServiceConfig } from './types.js';
import { MCPManager } from '../../../mcp/manager.js';
import { UnifiedToolManager } from '../../tools/unified-tool-manager.js';
import { ContextManager } from '../messages/manager.js';
import { ImageData } from '../messages/types.js';
import { logger } from '../../../logger/index.js';
// AWS SDK for native Bedrock
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
// OpenAI SDK for proxy mode
import OpenAI from 'openai';

export class AwsService implements ILLMService {
	private config: any;
	private mcpManager: MCPManager;
	private contextManager: ContextManager;
	private maxIterations: number;
	private unifiedToolManager: UnifiedToolManager | undefined = undefined;
	private bedrockClient?: BedrockRuntimeClient;
	private openaiClient?: OpenAI;
	private mode: 'native' | 'proxy';

	constructor(
		config: any,
		mcpManager: MCPManager,
		contextManager: ContextManager,
		maxIterations: number = 5,
		unifiedToolManager?: UnifiedToolManager
	) {
		this.config = config;
		this.mcpManager = mcpManager;
		this.contextManager = contextManager;
		this.maxIterations = maxIterations;
		this.unifiedToolManager = unifiedToolManager;

		// Detect mode: use proxy if baseURL is set and looks like OpenAI-compatible, else native
		if (config.baseURL && config.baseURL.includes('/v1')) {
			this.mode = 'proxy';
			this.openaiClient = new OpenAI({
				apiKey: config.apiKey,
				baseURL: config.baseURL,
			});
		} else {
			this.mode = 'native';
			if (config.nativeMode) {
				const clientConfig: any = { region: config.region };
				if (config.accessKeyId && config.secretAccessKey) {
					clientConfig.credentials = {
						accessKeyId: config.accessKeyId,
						secretAccessKey: config.secretAccessKey,
					};
				}
				this.bedrockClient = new BedrockRuntimeClient(clientConfig);
			}
		}
	}

	async generate(userInput: string, imageData?: ImageData, stream?: boolean): Promise<string> {
		if (this.mode === 'proxy' && this.openaiClient) {
			// Use OpenAI-compatible proxy
			// TODO: Use OpenAI formatter and tool integration as in OpenAIService
			try {
				const response = await this.openaiClient.chat.completions.create({
					model: this.config.model,
					messages: [{ role: 'user', content: userInput }],
				});
				return response.choices[0]?.message?.content || '';
			} catch (error) {
				logger.error('AWS Bedrock proxy mode error:', error);
				throw error;
			}
		} else if (this.mode === 'native' && this.bedrockClient) {
			// Use native Bedrock API
			// TODO: Use custom formatter for Bedrock (system prompt as separate field)
			try {
				const body = JSON.stringify({
					modelId: this.config.modelId || this.config.model,
					messages: [{ role: 'user', content: [{ type: 'text', text: userInput }] }],
					// Optionally add system prompt if available
					...(this.config.systemPrompt ? { system: this.config.systemPrompt } : {}),
					max_tokens: 1024,
				});
				const command = new InvokeModelCommand({
					modelId: this.config.modelId || this.config.model,
					body,
					contentType: 'application/json',
					accept: 'application/json',
				});
				const response = await this.bedrockClient.send(command);
				const responseBody = JSON.parse(new TextDecoder().decode(response.body));
				// TODO: Parse response according to Bedrock model output
				return (
					responseBody.output?.message?.content?.[0]?.text || responseBody.content?.[0]?.text || ''
				);
			} catch (error) {
				logger.error('AWS Bedrock native mode error:', error);
				throw error;
			}
		}
		throw new Error('AWS Bedrock service not properly configured.');
	}

	async directGenerate(userInput: string, systemPrompt?: string): Promise<string> {
		// Similar logic as generate, but without conversation context
		return this.generate(userInput);
	}

	async getAllTools() {
		if (this.unifiedToolManager) {
			return await this.unifiedToolManager.getAllTools();
		}
		return this.mcpManager.getAllTools();
	}

	getConfig(): LLMServiceConfig {
		return {
			provider: 'aws',
			model: this.config.model,
		};
	}
}
