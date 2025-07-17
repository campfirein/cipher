import { ILLMService, LLMServiceConfig } from './types.js';
import { MCPManager } from '../../../mcp/manager.js';
import { UnifiedToolManager } from '../../tools/unified-tool-manager.js';
import { ContextManager } from '../messages/manager.js';
import { ImageData } from '../messages/types.js';
import { logger } from '../../../logger/index.js';
import { OpenAIClient, AzureKeyCredential } from '@azure/openai';

export class AzureService implements ILLMService {
	private config: any;
	private mcpManager: MCPManager;
	private contextManager: ContextManager;
	private maxIterations: number;
	private unifiedToolManager: UnifiedToolManager | undefined = undefined;
	private azureClient: OpenAIClient;

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

		// Load credentials from config or environment variables
		const endpoint = config.endpoint || process.env.AZURE_OPENAI_ENDPOINT;
		const apiKey = config.apiKey || process.env.AZURE_OPENAI_API_KEY;
		if (!endpoint || !apiKey) {
			throw new Error('Azure OpenAI endpoint and API key are required.');
		}
		this.azureClient = new OpenAIClient(endpoint, new AzureKeyCredential(apiKey));
	}

	async generate(userInput: string, imageData?: ImageData, stream?: boolean): Promise<string> {
		// Use OpenAI formatter for message structure
		try {
			const deploymentName = this.config.deploymentName || process.env.AZURE_OPENAI_DEPLOYMENT;
			if (!deploymentName) {
				throw new Error('Azure OpenAI deployment name is required.');
			}
			const messages = [{ role: 'user', content: userInput }];
			const response = await this.azureClient.getChatCompletions(deploymentName, messages, {
				maxTokens: 1024,
			});
			return response.choices?.[0]?.message?.content || '';
		} catch (error) {
			logger.error('Azure OpenAI error:', error);
			throw error;
		}
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
			provider: 'azure',
			model: this.config.model,
		};
	}
}
