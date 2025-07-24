import {
	BedrockRuntimeClient,
	BedrockRuntimeClientConfig,
	InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { ILLMService, LLMServiceConfig } from './types.js';
import { AwsConfig } from '../config.js';
import { MCPManager } from '../../../mcp/manager.js';
import { ContextManager } from '../messages/manager.js';
import { UnifiedToolManager, CombinedToolSet } from '../../tools/unified-tool-manager.js';
import { ImageData } from '../messages/types.js';
import { ToolSet } from '../../../mcp/types.js';
import { logger } from '../../../logger/index.js';
import { formatToolResult } from '../utils/tool-result-formatter.js';
import { TextDecoder } from 'util';
import { BedrockAnthropicMessageFormatter, BedrockLlamaMessageFormatter, BedrockTitanMessageFormatter, BedrockDeepSeekMessageFormatter, BedrockAI21MessageFormatter } from '../messages/formatters/aws.js';

// Complete AWS Bedrock model families (2025)
enum ModelFamily {
	ANTHROPIC = 'anthropic',
	META_LLAMA = 'meta',
	AMAZON_TITAN = 'amazon.titan',
	AMAZON_NOVA = 'amazon.nova',
	AI21_LABS = 'ai21',
	COHERE = 'cohere',
	DEEPSEEK = 'deepseek',
	LUMA_AI = 'luma',
	MISTRAL_AI = 'mistral',
	STABILITY_AI = 'stability',
	TWELVELABS = 'twelvelabs',
	WRITER = 'writer'
}

export class AwsService implements ILLMService {
	private client: BedrockRuntimeClient;
	private model: string;
	private mcpManager: MCPManager;
	private unifiedToolManager: UnifiedToolManager | undefined;
	private contextManager: ContextManager;
	private maxIterations: number;
	private modelFamily: ModelFamily;
	private inferenceProfileArn: string | undefined;
	private formatter: any; // Should be IMessageFormatter, but use any for now if needed

	constructor(
		model: string,
		mcpManager: MCPManager,
		contextManager: ContextManager,
		unifiedToolManager?: UnifiedToolManager,
		maxIterations = 10,
		awsConfig?: AwsConfig
	) {
		this.model = model;
		this.mcpManager = mcpManager;
		this.unifiedToolManager = unifiedToolManager;
		this.contextManager = contextManager;
		this.maxIterations = maxIterations;
		this.modelFamily = this.detectModelFamily(model);
		this.inferenceProfileArn = awsConfig?.inferenceProfileArn || process.env.AWS_BEDROCK_INFERENCE_PROFILE_ARN;

		switch (this.modelFamily) {
			case ModelFamily.ANTHROPIC:
				this.formatter = new BedrockAnthropicMessageFormatter();
				break;
			case ModelFamily.META_LLAMA:
				this.formatter = new BedrockLlamaMessageFormatter();
				break;
			case ModelFamily.AMAZON_TITAN:
				this.formatter = new BedrockTitanMessageFormatter();
				break;
			case ModelFamily.DEEPSEEK:
				this.formatter = new BedrockDeepSeekMessageFormatter();
				break;
			case ModelFamily.AI21_LABS:
				this.formatter = new BedrockAI21MessageFormatter();
				break;
			default:
				this.formatter = new BedrockAnthropicMessageFormatter();
		}

		const clientConfig: BedrockRuntimeClientConfig = {
			region: awsConfig?.region || process.env.AWS_DEFAULT_REGION || 'us-east-1',
		};

		// Handle credentials from config or environment
		const accessKeyId = awsConfig?.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
		const secretAccessKey = awsConfig?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
		const sessionToken = awsConfig?.sessionToken || process.env.AWS_SESSION_TOKEN;

		if (accessKeyId && secretAccessKey) {
			const credentials: any = {
				accessKeyId,
				secretAccessKey,
			};
			if (sessionToken) {
				credentials.sessionToken = sessionToken;
			}
			clientConfig.credentials = credentials;
		}

		this.client = new BedrockRuntimeClient(clientConfig);

		logger.info(
			`AWS Bedrock service initialized with model: ${model} (family: ${this.modelFamily}) in region: ${clientConfig.region}`
		);
	}

	private detectModelFamily(modelId: string): ModelFamily {
		const id = modelId.toLowerCase();
		
		logger.info(`Detecting model family for: ${id}`);
		
		if (id.startsWith('anthropic.')) {
			logger.info(`Detected ANTHROPIC model family`);
			return ModelFamily.ANTHROPIC;
		}
		if (id.startsWith('meta.') || id.startsWith('us.meta.')) {
			logger.info(`Detected META_LLAMA model family`);
			return ModelFamily.META_LLAMA;
		}
		if (id.startsWith('amazon.titan')) {
			logger.debug(`Detected AMAZON_TITAN model family`);
			return ModelFamily.AMAZON_TITAN;
		}
		if (id.startsWith('amazon.nova')) {
			logger.debug(`Detected AMAZON_NOVA model family`);
			return ModelFamily.AMAZON_NOVA;
		}
		if (id.startsWith('ai21.')) {
			logger.debug(`Detected AI21_LABS model family`);
			return ModelFamily.AI21_LABS;
		}
		if (id.startsWith('cohere.')) {
			logger.debug(`Detected COHERE model family`);
			return ModelFamily.COHERE;
		}
		if (id.startsWith('deepseek') || id.startsWith('us.deepseek')) {
			logger.debug(`Detected DEEPSEEK model family`);
			return ModelFamily.DEEPSEEK;
		}
		if (id.startsWith('luma.')) {
			logger.debug(`Detected LUMA_AI model family`);
			return ModelFamily.LUMA_AI;
		}
		if (id.startsWith('mistral.')) {
			logger.debug(`Detected MISTRAL_AI model family`);
			return ModelFamily.MISTRAL_AI;
		}
		if (id.startsWith('stability.')) {
			logger.debug(`Detected STABILITY_AI model family`);
			return ModelFamily.STABILITY_AI;
		}
		if (id.startsWith('twelvelabs.')) {
			logger.debug(`Detected TWELVELABS model family`);
			return ModelFamily.TWELVELABS;
		}
		if (id.startsWith('writer.')) {
			logger.debug(`Detected WRITER model family`);
			return ModelFamily.WRITER;
		}
		
		// Default to Anthropic for backward compatibility
		logger.warn(`Unknown model family for ${modelId}, defaulting to Anthropic format`);
		return ModelFamily.ANTHROPIC;
	}

	async generate(userInput: string, imageData?: ImageData): Promise<string> {
		logger.info(`AWS generate called with userInput: ${userInput.substring(0, 100)}...`);
		await this.contextManager.addUserMessage(userInput, imageData);
		logger.info('User message added to context');

		// Get formatted tools
		let formattedTools: any[];
		if (this.unifiedToolManager) {
			logger.info('Getting tools from unified tool manager');
			formattedTools = await this.unifiedToolManager.getToolsForProvider('aws');
		} else {
			logger.info('Getting tools from MCP manager');
			const rawTools = await this.mcpManager.getAllTools();
			formattedTools = this.formatToolsForBedrock(rawTools);
		}

		logger.info(`Got ${formattedTools.length} formatted tools`);
		logger.silly(`Formatted tools: ${JSON.stringify(formattedTools, null, 2)}`);

		let iterationCount = 0;
		try {
			logger.info('Starting generation loop');
			while (iterationCount < this.maxIterations) {
				iterationCount++;
				logger.info(`Generation iteration ${iterationCount}`);

				logger.info('Calling getAIResponse');
				const response = await this.getAIResponse(formattedTools);
				logger.info('Got AI response, parsing...');

				// Parse response based on model family
				const { textContent, toolCalls } = this.parseResponse(response);
				logger.info(`Parsed response - textContent length: ${textContent?.length || 0}, toolCalls: ${toolCalls.length}`);

				if (toolCalls.length === 0) {
					// No tool calls, return the text content
					logger.info('No tool calls, adding assistant message and returning');
					await this.contextManager.addAssistantMessage(textContent);
					logger.info('Assistant message added, returning response');
					return textContent;
				}

				// Log thinking steps if there's text content before tool calls
				if (textContent && textContent.trim()) {
					logger.info(`💭 ${textContent.trim()}`);
				}

				await this.contextManager.addAssistantMessage(textContent, toolCalls);

				// Handle tool calls for supported model families
				if (toolCalls.length > 0) {
					for (const toolCall of toolCalls) {
						logger.debug(`Tool call initiated: ${JSON.stringify(toolCall, null, 2)}`);
						logger.info(`🔧 Using tool: ${toolCall.function.name}`);

						const toolName = toolCall.function.name;
						const args = JSON.parse(toolCall.function.arguments);

						try {
							let toolResult: string;
							if (this.unifiedToolManager) {
								toolResult = await this.unifiedToolManager.executeTool(toolName, args);
							} else {
								const toolExecutionResult = await this.mcpManager.executeTool(toolName, args);
								toolResult = toolExecutionResult.content;
							}

							const formattedResult = formatToolResult(toolName, toolResult);
							await this.contextManager.addToolResult(toolCall.id, toolName, formattedResult);
							logger.debug(`Tool result: ${formattedResult}`);
						} catch (error) {
							const errorMessage = `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
							await this.contextManager.addToolResult(toolCall.id, toolName, errorMessage);
							logger.error(`Tool execution error: ${errorMessage}`);
						}
					}
				}
			}

			throw new Error(`Maximum iterations (${this.maxIterations}) reached without completion`);
		} catch (error) {
			logger.error('AWS Bedrock generation error:', error);
			logger.error('Error details:', {
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				iterationCount,
				modelFamily: this.modelFamily,
				model: this.model
			});
			throw error;
		}
	}

	async directGenerate(userInput: string, systemPrompt?: string): Promise<string> {
		let messages;
		if (this.modelFamily === ModelFamily.ANTHROPIC) {
			messages = await this.contextManager.getAllFormattedMessages(false);
			if (!messages || messages.length === 0) {
				messages = [{
					role: 'user',
					content: [
						{ type: 'text', text: userInput }
					],
				}];
			}
		} else {
			messages = await this.contextManager.getAllFormattedMessages();
		}

		let request: any;

		const formattedMessage = this.formatter.format(messages[0], systemPrompt)[0];
		if (this.modelFamily === ModelFamily.ANTHROPIC) {
			request = {
				messages: [formattedMessage],
				anthropic_version: 'bedrock-2023-05-31',
				max_tokens: 4096,
				temperature: 0.7,
				...(systemPrompt ? { system: systemPrompt } : {}),
			};
		} else {
			request = formattedMessage;
		}

		const commandParams: any = {
			modelId: this.model,
			contentType: 'application/json',
			accept: 'application/json',
			body: JSON.stringify(request),
		};
		if (this.inferenceProfileArn) {
			commandParams.inferenceConfig = { profileId: this.inferenceProfileArn };
		}
		const command = new InvokeModelCommand(commandParams);

		const response = (await this.client.send(command)) as any;
		const responseBody = JSON.parse(new TextDecoder().decode(response.body)) as any; // BedrockResponse type removed

		const { textContent } = this.parseResponse(responseBody);
		return textContent;
	}

	async getAllTools(): Promise<ToolSet> {
		if (this.unifiedToolManager) {
			const combinedTools: CombinedToolSet = await this.unifiedToolManager.getAllTools();
			// Convert CombinedToolSet to ToolSet format
			const toolSet: ToolSet = {};
			for (const [toolName, toolInfo] of Object.entries(combinedTools)) {
				toolSet[toolName] = {
					description: toolInfo.description,
					parameters: toolInfo.parameters,
				};
			}
			return toolSet;
		}
		return this.mcpManager.getAllTools();
	}

	getConfig(): LLMServiceConfig {
		return {
			provider: 'aws',
			model: this.model,
		};
	}

	private async getAIResponse(formattedTools: any[]): Promise<any> { // BedrockResponse type removed
		logger.info('Getting formatted messages from context manager');
		let messages;
		if (this.modelFamily === ModelFamily.ANTHROPIC) {
			messages = await this.contextManager.getAllFormattedMessages(false);
		} else {
			messages = await this.contextManager.getAllFormattedMessages();
		}
		logger.info(`Got ${messages.length} messages from context`);
		
		logger.info('Getting system prompt from context manager');
		const systemPrompt = await this.contextManager.getSystemPrompt();
		logger.info(`Got system prompt: ${systemPrompt ? 'yes' : 'no'}`);

		logger.info(`Building request for model family: ${this.modelFamily}`);
		let request: any;

		if (this.modelFamily === ModelFamily.ANTHROPIC) {
			const formattedMessages = messages.map((msg: any) => this.formatter.format(msg, systemPrompt)[0]);
			request = {
				messages: formattedMessages,
				anthropic_version: 'bedrock-2023-05-31',
				max_tokens: 4096,
				temperature: 0.7,
				...(systemPrompt ? { system: systemPrompt } : {}),
			};
			if (formattedTools && formattedTools.length > 0) {
				request.tools = formattedTools;
			}
		} else {
			request = this.formatter.format(messages[0], systemPrompt)[0];
		}

		logger.info('Creating InvokeModelCommand');
		const commandParams: any = {
			modelId: this.model,
			contentType: 'application/json',
			accept: 'application/json',
			body: JSON.stringify(request),
		};
		if (this.inferenceProfileArn) {
			commandParams.inferenceConfig = { profileId: this.inferenceProfileArn };
		}
		const command = new InvokeModelCommand(commandParams);

		logger.info('Sending command to Bedrock client');
		const response = (await this.client.send(command)) as any;
		logger.info('Got response from Bedrock, parsing...');
		
		const parsedResponse = JSON.parse(new TextDecoder().decode(response.body)) as any; // BedrockResponse type removed
		logger.info('Response parsed successfully');
		return parsedResponse;
	}

	private parseResponse(response: any): { textContent: string; toolCalls: any[] } { // BedrockResponse type removed
		switch (this.modelFamily) {
			case ModelFamily.ANTHROPIC:
				return this.parseAnthropicResponse(response);
			case ModelFamily.META_LLAMA:
				return this.parseLlamaResponse(response);
			case ModelFamily.AMAZON_TITAN:
				return this.parseTitanResponse(response);
			case ModelFamily.AI21_LABS:
				return this.parseAI21Response(response);
			case ModelFamily.DEEPSEEK:
				return this.parseDeepSeekResponse(response);
			default:
				// Fallback to Anthropic parsing
				return this.parseAnthropicResponse(response);
		}
	}

	private parseAnthropicResponse(response: any): { textContent: string; toolCalls: any[] } { // BedrockResponse type removed
		const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');
		const textContent = response.content
			.filter(block => block.type === 'text')
			.map(block => block.text)
			.join('');

		const toolCalls = toolUseBlocks.map(block => ({
			id: block.id!,
			type: 'function' as const,
			function: {
				name: block.name!,
				arguments: JSON.stringify(block.input),
			},
		}));

		return { textContent, toolCalls };
	}

	private parseLlamaResponse(response: any): { textContent: string; toolCalls: any[] } { // BedrockResponse type removed
		return {
			textContent: response.generation,
			toolCalls: [], // Llama models don't support tool calling
		};
	}

	private parseTitanResponse(response: any): { textContent: string; toolCalls: any[] } { // BedrockResponse type removed
		const textContent = response.results.map(result => result.outputText).join('');
		return {
			textContent,
			toolCalls: [], // Titan models don't support tool calling
		};
	}

	private parseAI21Response(response: any): { textContent: string; toolCalls: any[] } { // BedrockResponse type removed
		const textContent = response.choices.map(choice => choice.message.content).join('');
		return {
			textContent,
			toolCalls: [], // AI21 models don't support tool calling in this implementation
		};
	}

	private parseDeepSeekResponse(response: any): { textContent: string; toolCalls: any[] } { // BedrockResponse type removed
		const textContent = response.choices.map(choice => choice.text).join('');
		return {
			textContent,
			toolCalls: [], // DeepSeek models don't support tool calling
		};
	}

	private supportsToolCalling(): boolean {
		// Currently support tool calling for these model families
		// Note: We can extend this as we implement tool calling for more families
		return [
			ModelFamily.ANTHROPIC,
			ModelFamily.META_LLAMA,
			ModelFamily.DEEPSEEK,
			// Add more families as we implement support
		].includes(this.modelFamily);
	}

	private formatToolsForBedrock(rawTools: ToolSet): any[] {
		if (!rawTools || typeof rawTools !== 'object') return [];
		return Object.entries(rawTools).map(([toolName, tool]) => ({
			name: toolName,
			description: tool.description,
			input_schema: tool.parameters,
		}));
	}
}
