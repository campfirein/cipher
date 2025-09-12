import Groq from 'groq-sdk';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
	BedrockRuntimeClient,
	BedrockRuntimeClientConfig,
	InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { OpenAIClient, AzureKeyCredential } from '@azure/openai';
import { ILLMService, LLMServiceConfig } from './types.js';
import { AwsConfig } from '../config.js';
import { MCPManager } from '../../../mcp/manager.js';
import { UnifiedToolManager, CombinedToolSet } from '../../tools/unified-tool-manager.js';
import { ContextManager } from '../messages/manager.js';
import { EventManager } from '../../../events/event-manager.js';
import { ImageData } from '../messages/types.js';
import { SessionEvents } from '../../../events/event-types.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../../logger/index.js';
import { formatToolResult } from '../utils/tool-result-formatter.js';
import { ToolSet } from '../../../mcp/types.js';
import { TextDecoder } from 'util';
import {
	BedrockAnthropicMessageFormatter,
	BedrockLlamaMessageFormatter,
	BedrockTitanMessageFormatter,
	BedrockDeepSeekMessageFormatter,
	BedrockAI21MessageFormatter,
} from '../messages/formatters/aws.js';

export type LLMProviderType =
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'groq'
	| 'aws'
	| 'azure'
	| 'ollama'
	| 'openrouter'
	| 'qwen'
	| 'vllm'
	| 'lmstudio';

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
	WRITER = 'writer',
}

export interface ExtendedLLMConfig {
	provider: LLMProviderType;
	model: string;
	apiKey?: string | undefined;
	baseURL?: string | undefined;
	maxIterations?: number | undefined;
	streaming?: boolean | undefined;
	region?: string | undefined;
	awsConfig?: AwsConfig | undefined;
	inferenceProfileArn?: string | undefined;
	endpoint?: string | undefined;
	deployment?: string | undefined;
	apiVersion?: string | undefined;
	resourceName?: string | undefined;
	enableThinking?: boolean | undefined;
	thinkingBudget?: number | undefined;
}

export class LLMServices implements ILLMService {
	private client: any;
	private model: string;
	private mcpManager: MCPManager;
	private contextManager: ContextManager;
	private unifiedToolManager?: UnifiedToolManager;
	private eventManager?: EventManager;
	private maxIterations: number = 5;
	private config: ExtendedLLMConfig;

	// AWS-specific properties
	private modelFamily?: ModelFamily;
	private awsFormatter?: any;
	private inferenceProfileArn?: string;

	constructor(
		config: ExtendedLLMConfig,
		mcpManager: MCPManager,
		contextManager: ContextManager,
		toolManager?: UnifiedToolManager,
		eventManager?: EventManager
	) {
		this.config = config;
		if (!config.model) {
			throw new Error('Model is required');
		}
		this.model = config.model;
		this.mcpManager = mcpManager;
		this.contextManager = contextManager;
		if (toolManager !== undefined) {
			this.unifiedToolManager = toolManager;
		}
		if (eventManager !== undefined) {
			this.eventManager = eventManager;
		}
		if (config.maxIterations) {
			this.maxIterations = config.maxIterations;
		}

		// Initialize AWS-specific properties if needed
		if (config.provider === 'aws') {
			this.modelFamily = this.detectModelFamily(config.model);
			const arn =
				config.inferenceProfileArn ||
				config.awsConfig?.inferenceProfileArn ||
				process.env.AWS_BEDROCK_INFERENCE_PROFILE_ARN;
			if (arn !== undefined) {
				this.inferenceProfileArn = arn;
			}
			this.awsFormatter = this.initializeAwsFormatter(this.modelFamily);
		}

		this.client = this.initializeClient(config);
	}

	private detectModelFamily(modelId: string): ModelFamily {
		const id = modelId.toLowerCase();
		logger.info(`Detecting model family for: ${id}`);

		if (id.startsWith('anthropic.') || id.startsWith('us.anthropic.')) {
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
		if (id.startsWith('ai21.') || id.startsWith('us.ai21.')) {
			logger.debug(`Detected AI21_LABS model family`);
			return ModelFamily.AI21_LABS;
		}
		if (id.startsWith('cohere.') || id.startsWith('us.cohere.')) {
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
		if (id.startsWith('mistral.') || id.startsWith('us.mistral.')) {
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

		logger.warn(`Unknown model family for ${modelId}, defaulting to Anthropic format`);
		return ModelFamily.ANTHROPIC;
	}

	private initializeAwsFormatter(modelFamily: ModelFamily): any {
		switch (modelFamily) {
			case ModelFamily.ANTHROPIC: {
				return new BedrockAnthropicMessageFormatter();
			}
			case ModelFamily.META_LLAMA: {
				return new BedrockLlamaMessageFormatter();
			}
			case ModelFamily.AMAZON_TITAN: {
				return new BedrockTitanMessageFormatter();
			}
			case ModelFamily.DEEPSEEK: {
				return new BedrockDeepSeekMessageFormatter();
			}
			case ModelFamily.AI21_LABS: {
				return new BedrockAI21MessageFormatter();
			}
			default: {
				return new BedrockAnthropicMessageFormatter();
			}
		}
	}

	private initializeClient(config: ExtendedLLMConfig): any {
		switch (config.provider) {
			case 'anthropic':
				return new Anthropic({
					apiKey: config.apiKey,
				});

			case 'openai':
				return new OpenAI({
					apiKey: config.apiKey,
					baseURL: config.baseURL,
				});

			case 'google':
				if (!config.apiKey) throw new Error('Google API key is required');
				return new GoogleGenerativeAI(config.apiKey);

			case 'groq':
				return new Groq({
					apiKey: config.apiKey,
				});

			case 'aws': {
				const clientConfig: BedrockRuntimeClientConfig = {
					region:
						config.awsConfig?.region ||
						config.region ||
						process.env.AWS_DEFAULT_REGION ||
						'us-east-1',
				};

				const accessKeyId = config.awsConfig?.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
				const secretAccessKey =
					config.awsConfig?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
				const sessionToken = config.awsConfig?.sessionToken || process.env.AWS_SESSION_TOKEN;

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

				logger.info(
					`AWS Bedrock service initialized with model: ${config.model} (family: ${this.modelFamily}) in region: ${clientConfig.region}`
				);

				return new BedrockRuntimeClient(clientConfig);
			}

			case 'azure': {
				const endpoint = config.endpoint || process.env.AZURE_OPENAI_ENDPOINT;
				const apiKey = config.apiKey || process.env.AZURE_OPENAI_API_KEY;

				if (!endpoint) {
					throw new Error('Azure OpenAI endpoint is required');
				}
				if (!apiKey) {
					throw new Error('Azure OpenAI API key is required');
				}

				return new OpenAIClient(endpoint, new AzureKeyCredential(apiKey));
			}

			case 'openrouter':
				return new OpenAI({
					apiKey: config.apiKey,
					baseURL: 'https://openrouter.ai/api/v1',
					defaultHeaders: {
						'HTTP-Referer': 'https://your-app.com',
						'X-Title': 'Your App Name',
					},
				});

			case 'qwen':
				return new OpenAI({
					apiKey: config.apiKey,
					baseURL: config.baseURL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
				});

			case 'vllm':
				return new OpenAI({
					apiKey: 'vllm',
					baseURL: config.baseURL || 'http://localhost:8000/v1',
				});

			case 'lmstudio':
				return new OpenAI({
					apiKey: 'lmstudio',
					baseURL: config.baseURL || 'http://localhost:1234/v1',
				});

			default:
				throw new Error(`Unsupported LLM provider: ${config.provider}`);
		}
	}

	setEventManager(eventManager: EventManager): void {
		this.eventManager = eventManager;
	}

	async generate(userInput: string, imageData?: ImageData, stream?: boolean): Promise<string> {
		await this.contextManager.addUserMessage(userInput, imageData);

		const messageId = uuidv4();
		const startTime = Date.now();
		const sessionId = (this.contextManager as any)?.sessionId;

		// Emit LLM response started event
		if (this.eventManager && sessionId) {
			this.eventManager.emitSessionEvent(sessionId, SessionEvents.LLM_RESPONSE_STARTED, {
				sessionId,
				messageId,
				model: this.model,
				timestamp: startTime,
			});
		}

		let response: string;
		switch (this.config.provider) {
			case 'anthropic':
				response = await this.generateAnthropic(userInput, imageData, stream);
				break;

			case 'google':
				response = await this.generateGoogle(userInput, imageData);
				break;

			case 'aws':
				response = await this.generateBedrock(userInput, imageData);
				break;

			case 'azure':
				response = await this.generateAzure(userInput, imageData, stream);
				break;

			case 'groq':
				response = await this.generateGroq(userInput, imageData, stream);
				break;

			case 'openai':
			case 'ollama':
			case 'openrouter':
			case 'qwen':
			case 'vllm':
			case 'lmstudio':
				response = await this.generateOpenAICompatible(userInput, imageData, stream);
				break;

			default:
				throw new Error(`Generation not implemented for provider: ${this.config.provider}`);
		}

		// Emit LLM response completed event
		if (this.eventManager && sessionId) {
			this.eventManager.emitSessionEvent(sessionId, SessionEvents.LLM_RESPONSE_COMPLETED, {
				sessionId,
				messageId,
				model: this.model,
				duration: Date.now() - startTime,
				timestamp: Date.now(),
				response,
			});
		}

		return response;
	}

	// ===================== PROVIDER-SPECIFIC GENERATION METHODS =====================

	private async generateOpenAICompatible(
		userInput: string,
		imageData?: ImageData,
		stream?: boolean
	): Promise<string> {
		const formattedTools = await this.getFormattedTools('openai');
		logger.silly(
			`Formatted tools for ${this.config.provider}: ${JSON.stringify(formattedTools, null, 2)}`
		);

		let iterationCount = 0;

		while (iterationCount < this.maxIterations) {
			iterationCount++;

			const { message } = await this.getOpenAIResponseWithRetries(
				formattedTools,
				userInput,
				stream
			);

			if (!message.tool_calls || message.tool_calls.length === 0) {
				const response = message.content || '';
				await this.contextManager.addAssistantMessage(response);
				return response;
			}

			await this.handleToolCalls(message);
		}

		throw new Error(`Maximum iterations (${this.maxIterations}) reached without final response`);
	}

	private async generateAnthropic(
		userInput: string,
		_imageData?: ImageData,
		stream?: boolean
	): Promise<string> {
		const formattedTools = await this.getFormattedTools('anthropic');
		let iterationCount = 0;

		while (iterationCount < this.maxIterations) {
			iterationCount++;

			const { response } = await this.getAnthropicResponseWithRetries(
				formattedTools,
				userInput,
				stream
			);

			// Extract text content and tool uses
			let textContent = '';
			const toolUses = [];

			for (const content of response.content) {
				if (content.type === 'text') {
					textContent += content.text;
				} else if (content.type === 'tool_use') {
					toolUses.push(content);
				}
			}

			if (toolUses.length === 0) {
				await this.contextManager.addAssistantMessage(textContent);
				return textContent;
			}

			await this.handleAnthropicToolUses(textContent, toolUses);
		}

		throw new Error(`Maximum iterations (${this.maxIterations}) reached without final response`);
	}

	private async generateGoogle(userInput: string, _imageData?: ImageData): Promise<string> {
		const client = this.client as GoogleGenerativeAI;
		const model = client.getGenerativeModel({ model: this.model });
		const formattedTools = await this.getFormattedTools('gemini');
		const sessionId = (this.contextManager as any)?.sessionId;
		const messageId = uuidv4();
		const startTime = Date.now(); // Add this missing variable
		let iterationCount = 0;
		let toolsUsedInThisConversation = false;

		try {
			while (iterationCount < this.maxIterations) {
				iterationCount++;
				const conversationHistory = await this.contextManager.getAllFormattedMessages();
				const hasToolCallsInHistory = conversationHistory.some(
					msg => msg.tool_calls && msg.tool_calls.length > 0
				);
				if (hasToolCallsInHistory) {
					toolsUsedInThisConversation = true;
				}

				// Fix: Get messages properly and create prompt
				const messages = await this.contextManager.getFormattedMessage({
					role: 'user',
					content: userInput,
				});

				const prompt = this.convertMessagesToPrompt(messages, userInput);
				let finalPrompt = prompt;

				if (formattedTools.length > 0 && iterationCount === 1 && !toolsUsedInThisConversation) {
					finalPrompt = this.addToolsToPrompt(prompt, formattedTools);
				}

				const result = await model.generateContent(finalPrompt);
				const rawText = result.response.text();

				const parsedResponse = this.parseGeminiResponse(rawText);

				if (!parsedResponse.tool_calls || parsedResponse.tool_calls.length === 0) {
					await this.contextManager.addAssistantMessage(parsedResponse.content);

					// Emit LLM response completed event
					if (this.eventManager && sessionId) {
						this.eventManager.emitSessionEvent(sessionId, SessionEvents.LLM_RESPONSE_COMPLETED, {
							sessionId,
							messageId,
							model: this.model,
							duration: Date.now() - startTime,
							timestamp: Date.now(),
							response: parsedResponse.content,
						});
					}

					return parsedResponse.content;
				}

				await this.handleToolCalls(parsedResponse);
				toolsUsedInThisConversation = true;
			}

			throw new Error(`Maximum iterations (${this.maxIterations}) reached without final response`);
		} catch (error) {
			logger.error('Error generating Google response:', error);
			throw error;
		}
	}

	private async generateBedrock(userInput: string, _imageData?: ImageData): Promise<string> {
		const client = this.client as BedrockRuntimeClient;
		const formattedTools = await this.getFormattedTools('aws');

		let iterationCount = 0;

		while (iterationCount < this.maxIterations) {
			iterationCount++;

			let messages;
			if (this.modelFamily === ModelFamily.ANTHROPIC) {
				messages = await this.contextManager.getAllFormattedMessages(false);
			} else {
				messages = await this.contextManager.getAllFormattedMessages();
			}
			const lastMessage = messages[messages.length - 1];
			if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== userInput) {
				messages.push({ role: 'user', content: userInput });
			}
			const systemPrompt = await this.contextManager.getSystemPrompt();
			let request: any;

			if (this.modelFamily === ModelFamily.ANTHROPIC) {
				const formattedMessages = messages
					.map((msg: any) => this.awsFormatter.format(msg, systemPrompt))
					.flat()
					.filter((msg: any) => msg !== null && msg !== undefined);

				request = {
					messages: formattedMessages,
					anthropic_version: 'bedrock-2023-05-31',
					max_tokens: 4096,
					temperature: 0.7,
					...(systemPrompt ? { system: systemPrompt } : {}),
				};

				if (formattedTools && formattedTools.length > 0) {
					request.tools = formattedTools;
					request.tool_choice = { type: 'auto' };
				}
			} else {
				request = this.awsFormatter.format(messages[0], systemPrompt)[0];
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
			const response = await client.send(command);
			const responseBody = JSON.parse(new TextDecoder().decode(response.body));

			const { textContent, toolCalls } = this.parseBedrockResponse(responseBody);

			if (!toolCalls || toolCalls.length === 0) {
				await this.contextManager.addAssistantMessage(textContent);
				return textContent;
			}

			await this.handleToolCalls({ content: textContent, tool_calls: toolCalls });
		}

		throw new Error(`Maximum iterations (${this.maxIterations}) reached without final response`);
	}

	private async generateAzure(
		userInput: string,
		_imageData?: ImageData,
		_stream?: boolean
	): Promise<string> {
		const client = this.client as OpenAIClient;
		const formattedTools = await this.getFormattedTools('azure');

		let iterationCount = 0;

		while (iterationCount < this.maxIterations) {
			iterationCount++;

			// Get conversation history and ensure current userInput is included
			const conversationHistory = await this.contextManager.getAllFormattedMessages();
			const systemMessage = await this.contextManager.getSystemPrompt();

			// Ensure the current userInput is the last message
			const lastMessage = conversationHistory[conversationHistory.length - 1];
			if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== userInput) {
				conversationHistory.push({ role: 'user', content: userInput });
			}

			const requestOptions: any = {
				temperature: 0.7,
				maxTokens: 4096,
				topP: 1,
			};

			if (formattedTools.length > 0) {
				requestOptions.tools = formattedTools;
				requestOptions.toolChoice = 'auto';
			}

			const formattedMessages = [
				...(systemMessage ? [{ role: 'system' as const, content: systemMessage }] : []),
				...conversationHistory,
			];

			const response = await client.getChatCompletions(
				this.config.deployment || this.model,
				formattedMessages,
				requestOptions
			);

			const choice = response.choices[0];
			if (!choice) {
				throw new Error('No choices returned from Azure OpenAI');
			}

			const message = choice.message as any;

			// Normalize tool calls format for Azure
			const normalizedMessage = {
				...message,
				tool_calls: message.toolCalls || message.tool_calls || undefined,
			};

			if (!normalizedMessage.tool_calls || normalizedMessage.tool_calls.length === 0) {
				const responseText = message.content || '';
				await this.contextManager.addAssistantMessage(responseText);
				return responseText;
			}

			await this.handleToolCalls(normalizedMessage);
		}

		throw new Error(`Maximum iterations (${this.maxIterations}) reached without final response`);
	}

	private async generateGroq(
		userInput: string,
		_imageData?: ImageData,
		_stream?: boolean
	): Promise<string> {
		const client = this.client as Groq;
		const formattedTools = await this.getFormattedTools('groq');

		let iterationCount = 0;
		let toolsUsedInThisConversation = false;

		while (iterationCount < this.maxIterations) {
			iterationCount++;

			// Get conversation history and ensure current userInput is included
			const conversationHistory = await this.contextManager.getAllFormattedMessages();

			// Ensure the current userInput is the last message
			const lastMessage = conversationHistory[conversationHistory.length - 1];
			if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== userInput) {
				conversationHistory.push({ role: 'user', content: userInput });
			}

			// Check if tools have been used in conversation history
			const hasToolCallsInHistory = conversationHistory.some(
				msg => msg.tool_calls && msg.tool_calls.length > 0
			);

			if (hasToolCallsInHistory) {
				toolsUsedInThisConversation = true;
			}

			const requestParams: any = {
				model: this.model,
				messages: conversationHistory,
				temperature: 0.7,
				max_tokens: 4096,
			};

			// Only offer tools on first attempt and if tools haven't been used yet
			if (iterationCount === 1 && formattedTools.length > 0 && !toolsUsedInThisConversation) {
				requestParams.tools = formattedTools;
				requestParams.tool_choice = 'auto';
			}

			const response = await client.chat.completions.create(requestParams);

			if (!response.choices || !response.choices[0] || !response.choices[0].message) {
				throw new Error('No message in response');
			}
			const message = response.choices[0].message;

			if (!message.tool_calls || message.tool_calls.length === 0) {
				const responseText = message.content || '';
				await this.contextManager.addAssistantMessage(responseText);
				return responseText;
			}

			await this.handleToolCalls(message);
			toolsUsedInThisConversation = true;
		}

		throw new Error(`Maximum iterations (${this.maxIterations}) reached without final response`);
	}

	// ===================== RETRY LOGIC METHODS =====================

	private async getOpenAIResponseWithRetries(
		tools: any[],
		userInput: string,
		stream?: boolean
	): Promise<{ message: any }> {
		let attempts = 0;
		const MAX_ATTEMPTS = 3;
		const client = this.client as OpenAI;

		while (attempts < MAX_ATTEMPTS) {
			attempts++;
			try {
				const messages = await this.contextManager.getFormattedMessage({
					role: 'user',
					content: userInput,
				});
				const systemMessage = await this.contextManager.getSystemPrompt();

				const requestBody: any = {
					model: this.model,
					messages: [
						...(systemMessage ? [{ role: 'system' as const, content: systemMessage }] : []),
						...messages,
					],
					tools: tools.length > 0 ? tools : undefined,
					tool_choice: tools.length > 0 ? 'auto' : undefined,
				};

				// Add Qwen-specific options
				if (this.config.provider === 'qwen') {
					requestBody.enable_thinking = this.config.enableThinking ?? false;
					if (this.config.thinkingBudget !== undefined) {
						requestBody.thinking_budget = this.config.thinkingBudget;
					}
				}

				if (stream !== undefined) {
					requestBody.stream = stream;
				}

				const completion = await client.chat.completions.create(requestBody);

				const message = completion.choices[0]?.message;
				if (!message) {
					throw new Error('No message in response');
				}

				return { message };
			} catch (error) {
				logger.warn(`${this.config.provider} API attempt ${attempts} failed:`, error);

				if (attempts === MAX_ATTEMPTS) {
					throw error;
				}

				await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
			}
		}

		throw new Error('Failed to get response after maximum retry attempts');
	}

	private async getGeminiResponseWithRetries(
		tools: any[],
		userInput: string,
		toolsUsedInHistory: boolean
	): Promise<{ message: any }> {
		let attempts = 0;
		const MAX_ATTEMPTS = 3;
		const client = this.client as GoogleGenerativeAI;
		const model = client.getGenerativeModel({ model: this.model });

		logger.debug(`Tools in Gemini response: ${tools.length}`);

		while (attempts < MAX_ATTEMPTS) {
			attempts++;
			try {
				const formattedMessages = await this.contextManager.getFormattedMessage({
					role: 'user',
					content: userInput,
				});

				logger.debug(`Sending ${formattedMessages.length} formatted messages to Gemini:`, {
					messages: formattedMessages.map((msg, idx) => ({
						index: idx,
						role: msg.role,
						hasContent: !!msg.content,
						hasToolCalls: !!msg.tool_calls,
						toolCallId: msg.tool_call_id,
						name: msg.name,
					})),
				});

				const prompt = this.convertMessagesToPrompt(formattedMessages, userInput);
				let finalPrompt = prompt;

				if (attempts === 1 && tools.length > 0 && !toolsUsedInHistory) {
					finalPrompt = this.addToolsToPrompt(prompt, tools);
				} else if (toolsUsedInHistory) {
					finalPrompt = `${prompt}

    IMPORTANT: Tools have already been used in this conversation. Please provide a final response based on the tool results that are already available. Do NOT make any additional tool calls.

    CONVERSATION STYLE:
    While you are primarily a programming assistant, you can engage in general conversation topics when appropriate. You don't need to restrict yourself to only programming discussions. Feel free to discuss various topics including sports, general knowledge, and other subjects when the user asks about them.`;
				}

				const result = await model.generateContent(finalPrompt);
				const response = result.response;
				const rawText = response.text();

				const parsedResponse = this.parseGeminiResponse(rawText);

				logger.silly('GEMINI GENERATE CONTENT RESPONSE: ', JSON.stringify(parsedResponse, null, 2));

				const message = parsedResponse;
				if (!message) {
					throw new Error('Received empty message from Gemini API');
				}

				return { message };
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				logger.error(`Gemini API call attempt ${attempts} failed: ${errorMessage}`, { error });

				if (attempts === MAX_ATTEMPTS) {
					throw new Error(`Gemini API call failed after ${MAX_ATTEMPTS} attempts: ${errorMessage}`);
				}

				await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
			}
		}

		throw new Error('Gemini API call failed after all retry attempts');
	}
	private async getAnthropicResponseWithRetries(
		tools: any[],
		_userInput: string,
		_stream?: boolean
	): Promise<{ response: any }> {
		let attempts = 0;
		const MAX_ATTEMPTS = 3;
		const client = this.client as Anthropic;

		while (attempts < MAX_ATTEMPTS) {
			attempts++;
			try {
				const formattedMessages = await this.contextManager.getAllFormattedMessages();
				const systemMessage = formattedMessages.find(msg => msg.role === 'system');
				const nonSystemMessages = formattedMessages.filter(msg => msg.role !== 'system');

				const response = await client.messages.create({
					model: this.model,
					messages: nonSystemMessages,
					...(systemMessage && { system: systemMessage.content }),
					tools: attempts === 1 ? tools : [],
					max_tokens: 4096,
				});

				if (!response || !response.content) {
					throw new Error('Received empty response from Anthropic API');
				}

				return { response };
			} catch (error) {
				logger.error(`Anthropic API attempt ${attempts} failed:`, error);
				if (attempts >= MAX_ATTEMPTS) throw error;
				await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
			}
		}
		throw new Error('Failed to get response after maximum retry attempts');
	}

	// ===================== TOOL HANDLING METHODS =====================

	private async handleToolCalls(message: any): Promise<void> {
		const sessionId = (this.contextManager as any)?.sessionId;

		if (message.content && message.content.trim()) {
			logger.info(`💭 ${message.content.trim()}`);

			if (this.eventManager && sessionId) {
				this.eventManager.emitSessionEvent(sessionId, SessionEvents.LLM_THINKING, {
					sessionId,
					messageId: uuidv4(),
					timestamp: Date.now(),
				});
			}
		}

		await this.contextManager.addAssistantMessage(message.content || '', message.tool_calls);

		for (const toolCall of message.tool_calls) {
			try {
				let toolResult: any;
				if (this.unifiedToolManager) {
					toolResult = await this.unifiedToolManager.executeTool(
						toolCall.function.name,
						JSON.parse(toolCall.function.arguments),
						sessionId
					);
				} else {
					toolResult = await this.mcpManager.executeTool(
						toolCall.function.name,
						JSON.parse(toolCall.function.arguments)
					);
				}

				const formattedResult = formatToolResult(toolCall.function.name, toolResult);
				logger.info(`📋 Tool Result:\n${formattedResult}`);

				if (typeof this.contextManager.addToolResult === 'function') {
					await this.contextManager.addToolResult(toolCall.id, toolCall.function.name, toolResult);
				} else {
					logger.warn(
						'contextManager.addToolResult is not available, skipping tool result storage'
					);
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				logger.error(`Tool execution error for ${toolCall.function.name}:`, error);
				if (typeof this.contextManager.addToolResult === 'function') {
					await this.contextManager.addToolResult(toolCall.id, toolCall.function.name, {
						error: errorMessage,
					});
				} else {
					logger.warn(
						'contextManager.addToolResult is not available, skipping tool result storage'
					);
				}
			}
		}
	}

	private async handleAnthropicToolUses(textContent: string, toolUses: any[]): Promise<void> {
		const formattedToolCalls = toolUses.map((toolUse: any) => ({
			id: toolUse.id,
			type: 'function' as const,
			function: {
				name: toolUse.name,
				arguments: JSON.stringify(toolUse.input),
			},
		}));

		await this.handleToolCalls({ content: textContent, tool_calls: formattedToolCalls });
	}

	// ===================== RESPONSE PARSING METHODS =====================

	private parseBedrockResponse(response: any): { textContent: string; toolCalls: any[] } {
		switch (this.modelFamily) {
			case ModelFamily.ANTHROPIC:
				return this.parseAnthropicBedrockResponse(response);
			case ModelFamily.META_LLAMA:
				return this.parseLlamaResponse(response);
			case ModelFamily.AMAZON_TITAN:
				return this.parseTitanResponse(response);
			case ModelFamily.AI21_LABS:
				return this.parseAI21Response(response);
			case ModelFamily.DEEPSEEK:
				return this.parseDeepSeekResponse(response);
			default:
				return this.parseAnthropicBedrockResponse(response);
		}
	}

	private parseAnthropicBedrockResponse(response: any): { textContent: string; toolCalls: any[] } {
		const toolUseBlocks = response.content.filter((block: any) => block.type === 'tool_use');
		const textContent = response.content
			.filter((block: any) => block.type === 'text')
			.map((block: any) => block.text)
			.join('');

		const toolCalls = toolUseBlocks.map((block: any) => ({
			id: block.id,
			type: 'function' as const,
			function: {
				name: block.name,
				arguments: JSON.stringify(block.input),
			},
		}));

		return { textContent, toolCalls };
	}

	private parseLlamaResponse(response: any): { textContent: string; toolCalls: any[] } {
		return {
			textContent: response.generation,
			toolCalls: [], // Llama models don't support tool calling
		};
	}

	private parseTitanResponse(response: any): { textContent: string; toolCalls: any[] } {
		const textContent = response.results.map((result: any) => result.outputText).join('');
		return {
			textContent,
			toolCalls: [], // Titan models don't support tool calling
		};
	}

	private parseAI21Response(response: any): { textContent: string; toolCalls: any[] } {
		const textContent = response.choices.map((choice: any) => choice.message.content).join('');
		return {
			textContent,
			toolCalls: [], // AI21 models don't support tool calling
		};
	}

	private parseDeepSeekResponse(response: any): { textContent: string; toolCalls: any[] } {
		const textContent = response.choices.map((choice: any) => choice.text).join('');
		return {
			textContent,
			toolCalls: [], // DeepSeek models don't support tool calling
		};
	}

	private parseGeminiResponse(text: string): any {
		const toolCallPattern = /```tool_code\s*\n?([^`]*)\n?```/gi;
		const toolCalls: any[] = [];
		let match;

		while ((match = toolCallPattern.exec(text)) !== null) {
			try {
				if (match[1]) {
					const toolCallData = JSON.parse(match[1].trim());
					toolCalls.push({
						id: `gemini_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
						type: 'function',
						function: {
							name: toolCallData.tool,
							arguments: JSON.stringify(toolCallData.arguments || {}),
						},
					});
				}
			} catch (e) {
				logger.warn('Failed to parse tool call from Gemini response', e);
			}
		}

		let textContent = '';
		if (toolCalls.length > 0) {
			const firstToolCallIndex = text.search(/```tool_code/);
			if (firstToolCallIndex > 0) {
				textContent = text.substring(0, firstToolCallIndex).trim();
			}
		} else {
			textContent = text.replace(/```tool_code\s*\n?[^`]*\n?```\s*/gi, '').trim();
		}

		return {
			content: textContent,
			tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
		};
	}

	// ===================== HELPER METHODS =====================

	private async getFormattedTools(
		provider: 'openai' | 'anthropic' | 'openrouter' | 'aws' | 'azure' | 'qwen' | 'gemini' | 'groq'
	): Promise<any[]> {
		try {
			if (!this.unifiedToolManager) {
				logger.warn(`UnifiedToolManager not available for provider ${provider}`);
				return [];
			}
			// Map provider names to what UnifiedToolManager expects
			const providerMapping: Record<string, string> = {
				openai: 'openai',
				anthropic: 'anthropic',
				openrouter: 'openrouter',
				aws: 'aws',
				azure: 'azure',
				qwen: 'qwen',
				gemini: 'gemini',
				groq: 'openai', // Groq uses OpenAI format
			};

			const mappedProvider = providerMapping[provider] || provider;
			return await this.unifiedToolManager.getToolsForProvider(mappedProvider as any);
		} catch (error) {
			logger.warn(`Failed to get formatted tools for provider ${provider}:`, error);
			return [];
		}
	}

	private convertMessagesToPrompt(messages: any[], userInput: string): string {
		const prompt = messages
			.map(msg => {
				if (msg.role === 'system') return `System: ${msg.content}`;
				if (msg.role === 'user') return `User: ${msg.content}`;
				if (msg.role === 'assistant') return `Assistant: ${msg.content}`;
				return msg.content;
			})
			.join('\n\n');

		return `${prompt}\n\nUser: ${userInput}`;
	}

	private addToolsToPrompt(prompt: string, tools: any[]): string {
		const toolDescriptions = tools
			.map(tool => {
				const func = tool.function;
				const params = func.parameters ? JSON.stringify(func.parameters, null, 2) : '{}';
				return `Tool: ${func.name}\nDescription: ${func.description}\nParameters: ${params}`;
			})
			.join('\n\n');

		return `${prompt}\n\nAvailable tools:\n${toolDescriptions}\n\nIf you need to use a tool, respond with a tool call in this format:\n\`\`\`tool_code\n{"tool": "tool_name", "arguments": {...}}\n\`\`\``;
	}

	// ===================== DIRECT GENERATION METHODS =====================

	async directGenerate(userInput: string, systemPrompt?: string): Promise<string> {
		try {
			switch (this.config.provider) {
				case 'aws': {
					return await this.directGenerateBedrock(userInput, systemPrompt);
				}

				case 'azure': {
					return await this.directGenerateAzure(userInput, systemPrompt);
				}

				case 'google': {
					const client = this.client as GoogleGenerativeAI;
					const model = client.getGenerativeModel({ model: this.model });
					const prompt = systemPrompt ? `${systemPrompt}\n\n${userInput}` : userInput;
					const result = await model.generateContent(prompt);
					return result.response.text();
				}

				case 'anthropic': {
					const body: any = {
						model: this.model,
						messages: [{ role: 'user', content: userInput }],
						max_tokens: 4096,
					};
					if (systemPrompt !== undefined) {
						body.system = systemPrompt;
					}
					const anthropicClient = this.client as Anthropic;
					const response = await anthropicClient.messages.create(body);
					return response.content.map(block => (block.type === 'text' ? block.text : '')).join('');
				}

				case 'groq': {
					const groqClient = this.client as Groq;
					const groqResponse = await groqClient.chat.completions.create({
						model: this.model,
						messages: [
							...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
							{ role: 'user', content: userInput },
						],
						temperature: 0.7,
						max_tokens: 4096,
					});
					return groqResponse.choices[0]?.message?.content || '';
				}

				default: {
					// OpenAI-compatible providers
					const openaiClient = this.client as OpenAI;

					const requestBody: any = {
						model: this.model,
						messages: [
							...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
							{ role: 'user', content: userInput },
						],
					};

					// Add Qwen-specific options
					if (this.config.provider === 'qwen') {
						requestBody.enable_thinking = this.config.enableThinking ?? false;
						if (this.config.thinkingBudget !== undefined) {
							requestBody.thinking_budget = this.config.thinkingBudget;
						}
					}

					const completion = await openaiClient.chat.completions.create(requestBody);
					return completion.choices[0]?.message?.content || '';
				}
			}
		} catch (error) {
			logger.error(`Direct generation error for ${this.config.provider}:`, error);
			throw error;
		}
	}
	private async directGenerateBedrock(userInput: string, systemPrompt?: string): Promise<string> {
		const client = this.client as BedrockRuntimeClient;

		let body: any;
		if (this.modelFamily === ModelFamily.ANTHROPIC) {
			body = {
				anthropic_version: 'bedrock-2023-05-31',
				max_tokens: 4000,
				messages: [{ role: 'user', content: userInput }],
				system: systemPrompt,
			};
		} else if (this.modelFamily === ModelFamily.AMAZON_TITAN) {
			body = {
				inputText: userInput,
				textGenerationConfig: {
					maxTokenCount: 4000,
					temperature: 0.7,
				},
			};
		} else {
			// Default to basic format for other models
			body = { prompt: userInput };
		}

		const command = new InvokeModelCommand({
			modelId: this.model,
			body: JSON.stringify(body),
			contentType: 'application/json',
		});

		const response = await client.send(command);
		const responseBody = JSON.parse(new TextDecoder().decode(response.body));

		const { textContent } = this.parseBedrockResponse(responseBody);
		return textContent;
	}

	private async directGenerateAzure(userInput: string, systemPrompt?: string): Promise<string> {
		const client = this.client as OpenAIClient;

		const messages: any[] = [];
		if (systemPrompt) {
			messages.push({ role: 'system', content: systemPrompt });
		}
		messages.push({ role: 'user', content: userInput });

		const response = await client.getChatCompletions(
			this.config.deployment || this.model,
			messages,
			{ temperature: 0.7, maxTokens: 4096, topP: 1 }
		);

		const choice = response.choices[0];
		if (!choice) {
			throw new Error('No choices returned from Azure OpenAI');
		}

		return choice.message?.content || '';
	}

	// ===================== INTERFACE IMPLEMENTATION =====================

	async getAllTools(): Promise<ToolSet | CombinedToolSet> {
		if (!this.unifiedToolManager) {
			logger.warn('UnifiedToolManager not available, returning empty tools');
			return {};
		}
		return this.unifiedToolManager.getAllTools();
	}

	getConfig(): LLMServiceConfig {
		return {
			provider: this.config.provider,
			model: this.model,
		};
	}

	public async generateResponse(
		sessionId: string,
		userMessage: string,
		tools?: ToolSet[],
		images?: ImageData[]
	): Promise<string> {
		return await this.generate(userMessage, images?.[0]);
	}
}
