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
		maxIterations: number = 5,
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

		// Use unified tool manager if available, otherwise fall back to MCP manager
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

				// Attempt to get a response, with retry logic
				const { message } = await this.getAIResponseWithRetries(formattedTools, userInput);

				// If there are no tool calls, we're done
				if (!message.tool_calls || message.tool_calls.length === 0) {
					const responseText = message.content || '';
					// Add assistant message to history
					await this.contextManager.addAssistantMessage(responseText);
					return responseText;
				}

				// Log thinking steps when assistant provides reasoning before tool calls
				if (message.content && message.content.trim()) {
					logger.info(`💭 ${message.content.trim()}`);
				}

				// Add assistant message with tool calls to history
				await this.contextManager.addAssistantMessage(message.content, message.tool_calls);

				// Handle tool calls
				for (const toolCall of message.tool_calls) {
					logger.debug(`Tool call initiated: ${JSON.stringify(toolCall, null, 2)}`);
					logger.info(`🔧 Using tool: ${toolCall.function.name}`);
					const toolName = toolCall.function.name;
					let args: any = {};

					try {
						args = JSON.parse(toolCall.function.arguments);
					} catch (e) {
						logger.error(`Error parsing arguments for ${toolName}:`, e);
						await this.contextManager.addToolResult(toolCall.id, toolName, {
							error: `Failed to parse arguments: ${e}`,
						});
						continue;
					}

					// Execute tool
					try {
						let result: any;
						if (this.unifiedToolManager) {
							result = await this.unifiedToolManager.executeTool(toolName, args);
						} else {
							result = await this.mcpManager.executeTool(toolName, args);
						}

						// Display formatted tool result
						const formattedResult = formatToolResult(toolName, result);
						logger.info(`📋 Tool Result:\n${formattedResult}`);

						// Add tool result to message manager
						await this.contextManager.addToolResult(toolCall.id, toolName, result);
					} catch (error) {
						// Handle tool execution error
						const errorMessage = error instanceof Error ? error.message : String(error);
						logger.error(`Tool execution error for ${toolName}: ${errorMessage}`);

						// Add error as tool result
						await this.contextManager.addToolResult(toolCall.id, toolName, {
							error: errorMessage,
						});
					}
				}
			}

			// If we reached max iterations, return a message
			logger.warn(`Reached maximum iterations (${this.maxIterations}) for task.`);
			const finalResponse = 'Task completed but reached maximum tool call iterations.';
			await this.contextManager.addAssistantMessage(finalResponse);
			return finalResponse;
		} catch (error) {
			// Handle API errors
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(`Error in Azure OpenAI service API call: ${errorMessage}`, { error });
			await this.contextManager.addAssistantMessage(`Error processing request: ${errorMessage}`);
			return `Error processing request: ${errorMessage}`;
		}
	}

	/**
	 * Direct generate method that bypasses conversation context
	 * Used for internal tool operations that shouldn't pollute conversation history
	 * @param userInput - The input to generate a response for
	 * @param systemPrompt - Optional system prompt to use
	 * @returns Promise<string> - The generated response
	 */
	async directGenerate(userInput: string, systemPrompt?: string): Promise<string> {
		try {
			logger.debug('AzureService: Direct generate call (bypassing conversation context)', {
				inputLength: userInput.length,
				hasSystemPrompt: !!systemPrompt,
			});

			// Create a minimal message array for direct API call
			const messages: any[] = [];

			if (systemPrompt) {
				messages.push({
					role: 'system',
					content: systemPrompt,
				});
			}

			messages.push({
				role: 'user',
				content: userInput,
			});

			// Make direct API call without adding to conversation context
			const response = await this.client.getChatCompletions(this.deploymentName, messages, {
				temperature: 0.7,
				maxTokens: 4096,
				topP: 1,
				// No tools for direct calls - this is for simple text generation
			});

			const choice = response.choices[0];
			if (!choice) {
				throw new Error('No choices returned from Azure OpenAI');
			}

			const responseText = choice.message?.content || '';

			logger.debug('AzureService: Direct generate completed', {
				responseLength: responseText.length,
			});

			return responseText;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('AzureService: Direct generate failed', {
				error: errorMessage,
				inputLength: userInput.length,
			});
			throw new Error(`Direct generate failed: ${errorMessage}`);
		}
	}

	async getAllTools(): Promise<ToolSet | CombinedToolSet> {
		if (this.unifiedToolManager) {
			return await this.unifiedToolManager.getAllTools();
		}
		return this.mcpManager.getAllTools();
	}

	getConfig(): LLMServiceConfig {
		return {
			provider: 'azure',
			model: this.model,
		};
	}

	// Helper methods
	private async getAIResponseWithRetries(
		tools: any[],
		userInput: string
	): Promise<{ message: any }> {
		let attempts = 0;
		const MAX_ATTEMPTS = 3;

		// Add a log of the number of tools in response
		logger.debug(`Tools in response: ${tools.length}`);

		while (attempts < MAX_ATTEMPTS) {
			attempts++;
			try {
				// Use the new method that implements proper flow: get system prompt, compress history, format messages
				const formattedMessages = await this.contextManager.getFormattedMessage({
					role: 'user',
					content: userInput,
				});

				// Debug log: Show exactly what messages are being sent to Azure OpenAI
				logger.debug(`Sending ${formattedMessages.length} formatted messages to Azure OpenAI:`, {
					messages: formattedMessages.map((msg, idx) => ({
						index: idx,
						role: msg.role,
						hasContent: !!msg.content,
						hasToolCalls: !!msg.tool_calls,
						toolCallId: msg.toolCallId || msg.tool_call_id,
						name: msg.name,
					})),
				});

				// Call Azure OpenAI API
				const requestOptions: any = {
					temperature: 0.7,
					maxTokens: 4096,
					topP: 1,
				};

				// Add tools if available - Azure uses different property names
				if (attempts === 1 && tools.length > 0) {
					requestOptions.tools = tools;
					requestOptions.toolChoice = 'auto'; // Azure uses toolChoice instead of tool_choice
				}

				const response = await this.client.getChatCompletions(
					this.deploymentName,
					formattedMessages,
					requestOptions
				);

				logger.silly('AZURE OPENAI CHAT COMPLETION RESPONSE: ', JSON.stringify(response, null, 2));

				// Get the response message and normalize tool calls format
				const choice = response.choices[0];
				if (!choice) {
					throw new Error('Received empty message from Azure OpenAI API');
				}

				const message = choice.message as any; // Azure API has different types than expected

				// Azure OpenAI may return tool calls in different formats, normalize to OpenAI format
				// Create a normalized message object that our code expects
				const normalizedMessage = {
					...message,
					tool_calls:
						message.toolCalls ||
						message.tool_calls ||
						(message.functionCall
							? [
									{
										id: `call_${Date.now()}`,
										type: 'function' as const,
										function: {
											name: message.functionCall.name,
											arguments: message.functionCall.arguments,
										},
									},
								]
							: undefined),
				};

				return { message: normalizedMessage };
			} catch (error) {
				const apiError = error as any;
				logger.error(
					`Error in Azure OpenAI API call (Attempt ${attempts}/${MAX_ATTEMPTS}): ${apiError.message || JSON.stringify(apiError, null, 2)}`,
					{ status: apiError.status, headers: apiError.headers }
				);

				// Azure OpenAI specific error handling
				if (apiError.status === 400) {
					if (
						apiError.message?.includes('context_length_exceeded') ||
						apiError.message?.includes('maximum context length')
					) {
						logger.warn(
							`Context length exceeded in Azure OpenAI. ContextManager compression might not be sufficient. Error details: ${JSON.stringify(apiError)}`
						);
					}
					if (apiError.message?.includes('tool_call_id')) {
						logger.warn(
							`Azure OpenAI tool_call_id error. This indicates message format issues. Error details: ${JSON.stringify(apiError)}`
						);
					}
				}

				if (attempts >= MAX_ATTEMPTS) {
					logger.error(`Failed to get response from Azure OpenAI after ${MAX_ATTEMPTS} attempts.`);
					throw error;
				}

				await new Promise(resolve => setTimeout(resolve, 500 * attempts));
			}
		}

		throw new Error('Failed to get response after maximum retry attempts');
	}

	private formatToolsForAzure(tools: ToolSet): any[] {
		// Keep the existing implementation
		// Convert the ToolSet object to an array of tools in Azure OpenAI's format (same as OpenAI)
		return Object.entries(tools).map(([name, tool]) => {
			return {
				type: 'function',
				function: {
					name,
					description: tool.description,
					parameters: tool.parameters,
				},
			};
		});
	}
}
