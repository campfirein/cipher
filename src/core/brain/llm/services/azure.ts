import { OpenAIClient, AzureKeyCredential } from '@azure/openai';
import { ILLMService, LLMServiceConfig } from './types.js';
import { AzureConfig } from '../config.js';
import { MCPManager } from '../../../mcp/manager.js';
import { ContextManager } from '../messages/manager.js';
import { UnifiedToolManager, CombinedToolSet } from '../../tools/unified-tool-manager.js';
import { ImageData } from '../messages/types.js';
import { ToolSet } from '../../../mcp/types.js';
import { logger } from '../../../logger/index.js';
import { formatToolResult } from '../utils/tool-result-formatter.js';

export class AzureService implements ILLMService {
	private client: OpenAIClient;
	private model: string;
	private mcpManager: MCPManager;
	private unifiedToolManager: UnifiedToolManager | undefined;
	private contextManager: ContextManager;
	private maxIterations: number;
	private deploymentName: string;

	constructor(
		model: string,
		mcpManager: MCPManager,
		contextManager: ContextManager,
		unifiedToolManager?: UnifiedToolManager,
		maxIterations = 10,
		azureConfig?: AzureConfig
	) {
		this.model = model;
		this.mcpManager = mcpManager;
		this.unifiedToolManager = unifiedToolManager;
		this.contextManager = contextManager;
		this.maxIterations = maxIterations;

		const endpoint = azureConfig?.endpoint || process.env.AZURE_OPENAI_ENDPOINT;
		const apiKey = process.env.AZURE_OPENAI_API_KEY;

		if (!endpoint) {
			throw new Error(
				'Azure OpenAI endpoint is required. Provide via config.azure.endpoint or AZURE_OPENAI_ENDPOINT environment variable'
			);
		}

		if (!apiKey) {
			throw new Error('AZURE_OPENAI_API_KEY environment variable is required');
		}

		// Use provided deployment name or fall back to model name
		this.deploymentName = azureConfig?.deploymentName || model;

		this.client = new OpenAIClient(endpoint, new AzureKeyCredential(apiKey));

		logger.info(
			`Azure OpenAI service initialized with deployment: ${this.deploymentName}, endpoint: ${endpoint}`
		);
	}

	async generate(userInput: string, imageData?: ImageData): Promise<string> {
		await this.contextManager.addUserMessage(userInput, imageData);

		// Get formatted tools
		let formattedTools: any[];
		if (this.unifiedToolManager) {
			formattedTools = await this.unifiedToolManager.getToolsForProvider('azure');
		} else {
			const rawTools = await this.mcpManager.getAllTools();
			formattedTools = this.formatToolsForAzure(rawTools);
		}

		logger.silly(`Formatted tools: ${JSON.stringify(formattedTools, null, 2)}`);

		let iterationCount = 0;
		try {
			while (iterationCount < this.maxIterations) {
				iterationCount++;

				const response = await this.getAIResponse(formattedTools);
				const choice = response.choices[0];

				if (!choice) {
					throw new Error('No choices returned from Azure OpenAI');
				}

				const message = choice.message;

				// If there are no function calls, we're done
				if (!message.functionCall) {
					const responseText = message.content || '';
					await this.contextManager.addAssistantMessage(responseText);
					return responseText;
				}

				// Log thinking steps when assistant provides reasoning before tool calls
				if (message.content && message.content.trim()) {
					logger.info(`💭 ${message.content.trim()}`);
				}

				// Convert function call to OpenAI format for context manager
				const toolCall = {
					id: `call_${Date.now()}`,
					type: 'function' as const,
					function: {
						name: message.functionCall.name,
						arguments: message.functionCall.arguments,
					},
				};

				await this.contextManager.addAssistantMessage(message.content, [toolCall]);

				// Handle the function call
				logger.debug(`Function call initiated: ${JSON.stringify(message.functionCall, null, 2)}`);
				logger.info(`🔧 Using tool: ${message.functionCall.name}`);

				const toolName = message.functionCall.name;
				let args: any = {};

				try {
					args = JSON.parse(message.functionCall.arguments);
				} catch (error) {
					logger.warn(`Failed to parse function arguments: ${message.functionCall.arguments}`);
				}

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

			throw new Error(`Maximum iterations (${this.maxIterations}) reached without completion`);
		} catch (error) {
			// logger.error('Azure OpenAI generation error:', error);
			// throw error;
		}
		return '';
	}

	async directGenerate(userInput: string, systemPrompt?: string): Promise<string> {
		const messages: any[] = [];

		if (systemPrompt) {
			messages.push({ role: 'system', content: systemPrompt });
		}

		messages.push({ role: 'user', content: userInput });

		const response = await this.client.getChatCompletions(this.deploymentName, messages, {
			temperature: 0.7,
			maxTokens: 4096,
			topP: 1,
		});

		const choice = response.choices[0];
		if (!choice) {
			throw new Error('No choices returned from Azure OpenAI');
		}

		return choice.message?.content || '';
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
			provider: 'azure',
			model: this.model,
		};
	}

	private async getAIResponse(formattedTools: any[]): Promise<any> {
		const messages = await this.contextManager.getAllFormattedMessages();

		logger.debug(`Azure service received ${formattedTools.length} formatted tools`);

		// The messages are already formatted by OpenAIMessageFormatter, so we can use them directly
		// But we need to convert OpenAI tool format to Azure function format for function calls
		const azureMessages = messages.map((msg: any) => {
			if (msg.role === 'tool') {
				// Convert OpenAI tool response to Azure function response
				return {
					role: 'function',
					name: msg.name,
					content: msg.content,
				};
			} else if (msg.role === 'assistant' && msg.tool_calls) {
				// Convert OpenAI tool_calls to Azure functionCall (single call only)
				const functionCall = msg.tool_calls[0]; // Azure only supports one function call per message
				return {
					role: 'assistant',
					content: msg.content || '',
					functionCall: {
						name: functionCall.function.name,
						arguments: functionCall.function.arguments,
					},
				};
			}
			// For all other messages, use as-is
			return msg;
		});

		const requestOptions: any = {
			temperature: 0.7,
			maxTokens: 4096,
			topP: 1,
		};

		// Add functions if available
		if (formattedTools.length > 0) {
			// Validate that functions have required fields
			const validFunctions = formattedTools.filter(
				func => func && func.name && func.description && func.parameters
			);

			if (validFunctions.length > 0) {
				logger.debug(`Azure service using ${validFunctions.length} valid functions`);
				requestOptions.functions = validFunctions;
				requestOptions.functionCall = 'auto';
			} else {
				logger.warn('No valid functions found for Azure service, skipping function calling');
			}
		}

		return this.client.getChatCompletions(this.deploymentName, azureMessages, requestOptions);
	}

	private formatToolsForAzure(rawTools: ToolSet): any[] {
		if (!rawTools || typeof rawTools !== 'object') return [];
		return Object.entries(rawTools).map(([toolName, tool]) => ({
			name: toolName,
			description: tool.description,
			parameters: tool.parameters,
		}));
	}
}
