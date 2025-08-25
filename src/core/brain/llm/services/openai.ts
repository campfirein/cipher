import { ToolSet } from '../../../mcp/types.js';
import { MCPManager } from '../../../mcp/manager.js';
import { UnifiedToolManager, CombinedToolSet } from '../../tools/unified-tool-manager.js';
import { ContextManager } from '../messages/manager.js';
import { ImageData } from '../messages/types.js';
import { ILLMService, LLMServiceConfig } from './types.js';
import OpenAI from 'openai';
import { logger } from '../../../logger/index.js';
import { formatToolResult } from '../utils/tool-result-formatter.js';
import { EventManager } from '../../../events/event-manager.js';
import { SessionEvents } from '../../../events/event-types.js';
import { v4 as uuidv4 } from 'uuid';

export class OpenAIService implements ILLMService {
	private openai: OpenAI;
	private model: string;
	private mcpManager: MCPManager;
	private unifiedToolManager: UnifiedToolManager | undefined;
	private contextManager: ContextManager;
	private maxIterations: number;
	private eventManager?: EventManager;

	constructor(
		openai: OpenAI,
		model: string,
		mcpManager: MCPManager,
		contextManager: ContextManager,
		maxIterations: number = 5,
		unifiedToolManager?: UnifiedToolManager
	) {
		this.openai = openai;
		this.model = model;
		this.mcpManager = mcpManager;
		this.unifiedToolManager = unifiedToolManager;
		this.contextManager = contextManager;
		this.maxIterations = maxIterations;
	}

	/**
	 * Set the event manager for emitting LLM response events
	 */
	setEventManager(eventManager: EventManager): void {
		this.eventManager = eventManager;
	}

	async generate(userInput: string, imageData?: ImageData): Promise<string> {
		console.log("Calling LLM with userInput: ", userInput);
		await this.contextManager.addUserMessage(userInput, imageData);

		const messageId = uuidv4();
		const startTime = Date.now();

		// Try to get sessionId from contextManager if available, otherwise undefined
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

		// Use unified tool manager if available, otherwise fall back to MCP manager
		let formattedTools: any[];
		if (this.unifiedToolManager) {
			formattedTools = await this.unifiedToolManager.getToolsForProvider('openai');
		} else {
			const rawTools = await this.mcpManager.getAllTools();
			formattedTools = this.formatToolsForOpenAI(rawTools);
		}

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

					// Emit LLM response completed event
					if (this.eventManager && sessionId) {
						this.eventManager.emitSessionEvent(sessionId, SessionEvents.LLM_RESPONSE_COMPLETED, {
							sessionId,
							messageId,
							model: this.model,
							duration: Date.now() - startTime,
							timestamp: Date.now(),
							response: responseText,
						});
					}

					return responseText;
				}

				// Log thinking steps when assistant provides reasoning before tool calls
				if (message.content && message.content.trim()) {
					logger.info(`💭 ${message.content.trim()}`);

					// Emit thinking event
					if (this.eventManager && sessionId) {
						this.eventManager.emitSessionEvent(sessionId, SessionEvents.LLM_THINKING, {
							sessionId,
							messageId,
							timestamp: Date.now(),
						});
					}
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
							result = await this.unifiedToolManager.executeTool(toolName, args, sessionId);
						} else {
							result = await this.mcpManager.executeTool(toolName, args);
						}

						// Display formatted tool result
						const formattedResult = formatToolResult(toolName, result);
						logger.info(`📋 Tool Result:\n${formattedResult}`);

						// Add tool result to context
						await this.contextManager.addToolResult(toolCall.id, toolName, result);
					} catch (error) {
						logger.error(`Error executing tool ${toolName}:`, error);
						await this.contextManager.addToolResult(toolCall.id, toolName, {
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}
			}

			throw new Error(`Maximum iterations (${this.maxIterations}) exceeded`);
		} catch (error) {
			logger.error('Error in OpenAI service:', error);
			throw error;
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
			logger.debug('OpenAIService: Direct generate call (bypassing conversation context)', {
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
			const response = await this.openai.chat.completions.create({
				model: this.model,
				messages: messages,
				// No tools for direct calls - this is for simple text generation
			});

			const responseText = response.choices[0]?.message?.content || '';

			logger.debug('OpenAIService: Direct generate completed', {
				responseLength: responseText.length,
			});

			return responseText;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('OpenAIService: Direct generate failed', {
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

				// Debug log: Show exactly what messages are being sent to OpenAI
				logger.debug(`Sending ${formattedMessages.length} formatted messages to OpenAI:`, {
					messages: formattedMessages.map((msg, idx) => ({
						index: idx,
						role: msg.role,
						hasContent: !!msg.content,
						hasToolCalls: !!msg.tool_calls,
						toolCallId: msg.tool_call_id,
						name: msg.name,
					})),
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
}
