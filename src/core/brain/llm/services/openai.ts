import { ToolSet } from '../../../mcp/types.js';
import { MCPManager } from '../../../mcp/manager.js';
import { ContextManager } from '../messages/manager.js';
import { ImageData } from '../messages/types.js';
import { ILLMService, LLMServiceConfig } from './types.js';
import OpenAI from 'openai';
import { logger } from '../../../logger/index.js';

export class OpenAIService implements ILLMService {
	private openai: OpenAI;
	private model: string;
	private mcpManager: MCPManager;
	private contextManager: ContextManager;
	private maxIterations: number;

	constructor(
		openai: OpenAI,
		model: string,
		mcpManager: MCPManager,
		contextManager: ContextManager,
		maxIterations: number = 5
	) {
		this.openai = openai;
		this.model = model;
		this.mcpManager = mcpManager;
		this.contextManager = contextManager;
		this.maxIterations = maxIterations;
	}
	async generate(userInput: string, imageData?: ImageData): Promise<string> {
		await this.contextManager.addUserMessage(userInput, imageData);
		const rawTools = await this.mcpManager.getAllTools();
		const formattedTools = this.formatToolsForOpenAI(rawTools);

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

				// Add assistant message with tool calls to history
				await this.contextManager.addAssistantMessage(message.content, message.tool_calls);

				// Handle tool calls
				for (const toolCall of message.tool_calls) {
					logger.debug(`Tool call initiated: ${JSON.stringify(toolCall, null, 2)}`);
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
						const result = await this.mcpManager.executeTool(toolName, args);

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
			logger.error(`Error in OpenAI service API call: ${errorMessage}`, { error });
			await this.contextManager.addAssistantMessage(`Error processing request: ${errorMessage}`);
			return `Error processing request: ${errorMessage}`;
		}
	}
	getAllTools(): Promise<ToolSet> {
		return this.mcpManager.getAllTools();
	}

	getConfig(): LLMServiceConfig {
		return {
			provider: 'openai',
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

				// Call OpenAI API
				const response = await this.openai.chat.completions.create({
					model: this.model,
					messages: formattedMessages,
					tools: attempts === 1 ? tools : [], // Only offer tools on first attempt
					tool_choice: attempts === 1 ? 'auto' : 'none', // Disable tool choice on retry
				});

				logger.silly('OPENAI CHAT COMPLETION RESPONSE: ', JSON.stringify(response, null, 2));

				// Get the response message
				const message = response.choices[0]?.message;
				if (!message) {
					throw new Error('Received empty message from OpenAI API');
				}

				return { message };
			} catch (error) {
				const apiError = error as any;
				logger.error(
					`Error in OpenAI API call (Attempt ${attempts}/${MAX_ATTEMPTS}): ${apiError.message || JSON.stringify(apiError, null, 2)}`,
					{ status: apiError.status, headers: apiError.headers }
				);

				if (apiError.status === 400 && apiError.error?.code === 'context_length_exceeded') {
					logger.warn(
						`Context length exceeded. ContextManager compression might not be sufficient. Error details: ${JSON.stringify(apiError.error)}`
					);
				}

				if (attempts >= MAX_ATTEMPTS) {
					logger.error(`Failed to get response from OpenAI after ${MAX_ATTEMPTS} attempts.`);
					throw error;
				}

				await new Promise(resolve => setTimeout(resolve, 500 * attempts));
			}
		}

		throw new Error('Failed to get response after maximum retry attempts');
	}

	private formatToolsForOpenAI(tools: ToolSet): any[] {
		// Keep the existing implementation
		// Convert the ToolSet object to an array of tools in OpenAI's format
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

	// --- ADDED: Embedding generation ---
	/**
	 * Generate an embedding vector for a given input string using the OpenAI API.
	 * @param input The text to embed.
	 * @returns Promise<number[]> The embedding vector.
	 */
	static async generateEmbedding(apiKey: string, input: string): Promise<number[]> {
		const openai = new OpenAI({ apiKey });
		const response = await openai.embeddings.create({
			model: 'text-embedding-ada-002', // Or another embedding model if preferred
			input,
		});
		const embedding = response.data[0]?.embedding;
		if (!embedding) throw new Error('Failed to generate embedding');
		return embedding;
	}
}
