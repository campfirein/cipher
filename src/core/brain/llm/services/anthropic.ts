import Anthropic from '@anthropic-ai/sdk';
import { ToolSet } from '../../../mcp/types.js';
import { MCPManager } from '../../../mcp/manager.js';
import { UnifiedToolManager, CombinedToolSet } from '../../tools/unified-tool-manager.js';
import { ContextManager } from '../messages/manager.js';
import { ImageData } from '../messages/types.js';
import { ILLMService, LLMServiceConfig } from './types.js';
import { logger } from '../../../logger/index.js';
import { formatToolResult } from '../utils/tool-result-formatter.js';
import { EventManager } from '../../../events/event-manager.js';
import { SessionEvents } from '../../../events/event-types.js';
import { v4 as uuidv4 } from 'uuid';

export class AnthropicService implements ILLMService {
	private anthropic: Anthropic;
	private model: string;
	private mcpManager: MCPManager;
	private unifiedToolManager: UnifiedToolManager | undefined;
	private contextManager: ContextManager;
	private maxIterations: number;
	private eventManager?: EventManager;

	constructor(
		anthropic: Anthropic,
		model: string,
		mcpManager: MCPManager,
		contextManager: ContextManager,
		maxIterations: number = 10,
		unifiedToolManager?: UnifiedToolManager
	) {
		this.anthropic = anthropic;
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

	async generate(userInput: string, imageData?: ImageData, sessionId?: string): Promise<string> {
		await this.contextManager.addUserMessage(userInput, imageData);

		const messageId = uuidv4();
		const startTime = Date.now();

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
			formattedTools = await this.unifiedToolManager.getToolsForProvider('anthropic');
		} else {
			const rawTools = await this.mcpManager.getAllTools();
			formattedTools = this.formatToolsForAnthropic(rawTools);
		}

		logger.silly(`Formatted tools: ${JSON.stringify(formattedTools, null, 2)}`);

		let iterationCount = 0;
		try {
			while (iterationCount < this.maxIterations) {
				iterationCount++;

				// Attempt to get a response, with retry logic
				const { response, fullContent } = await this.getAIResponseWithRetries(
					formattedTools,
					userInput,
					sessionId,
					messageId
				);

				// Extract text content and tool uses
				let textContent = fullContent || '';
				const toolUses = [];

				// If we didn't get fullContent from streaming, extract from response
				if (!fullContent) {
					for (const content of response.content) {
						if (content.type === 'text') {
							textContent += content.text;
						} else if (content.type === 'tool_use') {
							toolUses.push(content);
						}
					}
				} else {
					// For streaming responses, we still need to check for tool uses
					for (const content of response.content) {
						if (content.type === 'tool_use') {
							toolUses.push(content);
						}
					}
				}

				// If there are no tool uses, we're done
				if (toolUses.length === 0) {
					// Add assistant message to history
					await this.contextManager.addAssistantMessage(textContent);

					// Emit LLM response completed event (only if we haven't been streaming)
					if (this.eventManager && sessionId && !fullContent) {
						this.eventManager.emitSessionEvent(sessionId, SessionEvents.LLM_RESPONSE_COMPLETED, {
							sessionId,
							messageId,
							model: this.model,
							content: textContent, // Include the actual response content
							response: textContent, // Also include as 'response' for backward compatibility
							duration: Date.now() - startTime,
							timestamp: Date.now(),
						});
					}

					return textContent;
				}

				// Log thinking steps when assistant provides reasoning before tool calls
				if (textContent && textContent.trim()) {
					logger.info(`💭 ${textContent.trim()}`);

					// Emit thinking event
					if (this.eventManager && sessionId) {
						this.eventManager.emitSessionEvent(sessionId, SessionEvents.LLM_THINKING, {
							sessionId,
							messageId,
							timestamp: Date.now(),
						});
					}
				}

				// Transform tool uses into the format expected by ContextManager
				const formattedToolCalls = toolUses.map((toolUse: any) => ({
					id: toolUse.id,
					type: 'function' as const,
					function: {
						name: toolUse.name,
						arguments: JSON.stringify(toolUse.input),
					},
				}));

				// Add assistant message with tool calls to history
				await this.contextManager.addAssistantMessage(textContent, formattedToolCalls);

				// Handle tool uses
				for (const toolUse of toolUses) {
					logger.debug(`Tool call initiated: ${JSON.stringify(toolUse, null, 2)}`);
					logger.info(`🔧 Using tool: ${toolUse.name}`);
					const toolName = toolUse.name;
					const args = toolUse.input;
					const toolUseId = toolUse.id;

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
						await this.contextManager.addToolResult(toolUseId, toolName, result);
					} catch (error) {
						// Handle tool execution error
						const errorMessage = error instanceof Error ? error.message : String(error);
						logger.error(`Tool execution error for ${toolName}: ${errorMessage}`);

						// Add error as tool result
						await this.contextManager.addToolResult(toolUseId, toolName, {
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

			// Emit LLM response error event
			if (this.eventManager && sessionId) {
				this.eventManager.emitSessionEvent(sessionId, SessionEvents.LLM_RESPONSE_ERROR, {
					sessionId,
					messageId,
					model: this.model,
					error: errorMessage,
					timestamp: Date.now(),
				});
			}
			logger.error(`Error in Anthropic service API call: ${errorMessage}`, { error });
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
	async directGenerate(_userInput: string, systemPrompt?: string): Promise<string> {
		let attempts = 0;
		const MAX_ATTEMPTS = 3;

		logger.debug('AnthropicService: Direct generate call (bypassing conversation context)', {
			inputLength: _userInput.length,
			hasSystemPrompt: !!systemPrompt,
		});

		while (attempts < MAX_ATTEMPTS) {
			attempts++;
			try {
				// Create a minimal message array for direct API call
				const messages = [
					{
						role: 'user' as const,
						content: _userInput,
					},
				];

				// Make direct API call without adding to conversation context
				const response = await this.anthropic.messages.create({
					model: this.model,
					messages: messages,
					...(systemPrompt && { system: systemPrompt }),
					max_tokens: 4096,
					// No tools for direct calls - this is for simple text generation
				});

				// Extract text content from response
				let textContent = '';
				for (const content of response.content) {
					if (content.type === 'text') {
						textContent += content.text;
					}
				}

				logger.debug('AnthropicService: Direct generate completed', {
					responseLength: textContent.length,
				});

				return textContent;
			} catch (error) {
				const apiError = error as any;
				const errorStatus = apiError.status || apiError.error?.status;
				const errorType = apiError.error?.type || 'unknown_error';
				const errorMessage = apiError.message || apiError.error?.message || 'Unknown error';

				logger.error(
					`Error in Anthropic direct generate call (Attempt ${attempts}/${MAX_ATTEMPTS}): ${errorMessage}`,
					{
						status: errorStatus,
						type: errorType,
						attempt: attempts,
						maxAttempts: MAX_ATTEMPTS,
						inputLength: _userInput.length,
					}
				);

				// Check if this is a retryable error
				const isRetryable = this.isRetryableError(errorStatus, errorType);

				if (attempts >= MAX_ATTEMPTS || !isRetryable) {
					if (!isRetryable) {
						logger.error(`Non-retryable error in direct generate: ${errorType} (${errorStatus})`);
					} else {
						logger.error(`Failed direct generate after ${MAX_ATTEMPTS} attempts.`);
					}
					throw new Error(`Direct generate failed: ${errorMessage}`);
				}

				// Calculate delay with exponential backoff and jitter
				const delay = this.calculateRetryDelay(attempts, errorStatus, errorType);
				logger.info(
					`Retrying direct generate in ${delay}ms... (Attempt ${attempts + 1}/${MAX_ATTEMPTS})`
				);

				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}

		throw new Error('Direct generate failed after maximum retry attempts');
	}

	async getAllTools(): Promise<ToolSet | CombinedToolSet> {
		if (this.unifiedToolManager) {
			return await this.unifiedToolManager.getAllTools();
		}
		return this.mcpManager.getAllTools();
	}

	getConfig(): LLMServiceConfig {
		return {
			provider: 'anthropic',
			model: this.model,
		};
	}

	// Helper methods
	private async getAIResponseWithRetries(
		tools: any[],
		_userInput: string,
		sessionId?: string,
		messageId?: string
	): Promise<{ response: any; fullContent?: string }> {
		let attempts = 0;
		const MAX_ATTEMPTS = 3;

		// Add a log of the number of tools in response
		logger.debug(`Tools in response: ${tools.length}`);

		while (attempts < MAX_ATTEMPTS) {
			attempts++;
			try {
				// Get all formatted messages from conversation history
				const formattedMessages = await this.contextManager.getAllFormattedMessages();

				// For Anthropic, we need to separate system messages from the messages array
				const systemMessage = formattedMessages.find(msg => msg.role === 'system');
				const nonSystemMessages = formattedMessages.filter(msg => msg.role !== 'system');

				// Determine if we should use streaming (first attempt with event management)
				const shouldStream = attempts === 1 && sessionId && messageId && this.eventManager;

				if (shouldStream) {
					// Use streaming for responses (tools allowed)
					return await this.getStreamingResponse(
						nonSystemMessages,
						systemMessage,
						sessionId,
						messageId,
						tools
					);
				} else {
					// Use non-streaming for tool calls or retries
					const response = await this.anthropic.messages.create({
						model: this.model,
						messages: nonSystemMessages,
						...(systemMessage && { system: systemMessage.content }),
						tools: attempts === 1 ? tools : [], // Only offer tools on first attempt
						max_tokens: 4096,
					});

					logger.silly('ANTHROPIC MESSAGE RESPONSE: ', JSON.stringify(response, null, 2));

					if (!response || !response.content) {
						throw new Error('Received empty response from Anthropic API');
					}

					return { response };
				}
			} catch (error) {
				const apiError = error as any;
				const errorStatus = apiError.status || apiError.error?.status;
				const errorType = apiError.error?.type || 'unknown_error';
				const errorMessage = apiError.message || apiError.error?.message || 'Unknown error';

				logger.error(
					`Error in Anthropic API call (Attempt ${attempts}/${MAX_ATTEMPTS}): ${errorMessage}`,
					{
						status: errorStatus,
						type: errorType,
						attempt: attempts,
						maxAttempts: MAX_ATTEMPTS,
					}
				);

				// Handle specific error types
				if (
					errorType === 'invalid_request_error' &&
					errorMessage.includes('maximum context length')
				) {
					logger.warn(
						`Context length exceeded. ContextManager compression might not be sufficient. Error details: ${JSON.stringify(apiError.error)}`
					);
				}

				// Check if this is a retryable error
				const isRetryable = this.isRetryableError(errorStatus, errorType);

				if (attempts >= MAX_ATTEMPTS || !isRetryable) {
					if (!isRetryable) {
						logger.error(`Non-retryable error encountered: ${errorType} (${errorStatus})`);
					} else {
						logger.error(`Failed to get response from Anthropic after ${MAX_ATTEMPTS} attempts.`);
					}
					throw error;
				}

				// Calculate delay with exponential backoff and jitter
				const delay = this.calculateRetryDelay(attempts, errorStatus, errorType);
				logger.info(`Retrying in ${delay}ms... (Attempt ${attempts + 1}/${MAX_ATTEMPTS})`);

				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}

		throw new Error('Failed to get response after maximum retry attempts');
	}

	private async getStreamingResponse(
		nonSystemMessages: any[],
		systemMessage: any,
		sessionId: string,
		messageId: string,
		tools?: any[]
	): Promise<{ response: any; fullContent: string }> {
		let fullContent = '';
		let response: any = { content: [{ type: 'text', text: '' }] };

		try {
			const stream = await this.anthropic.messages.create({
				model: this.model,
				messages: nonSystemMessages,
				...(systemMessage && { system: systemMessage.content }),
				...(tools && tools.length > 0 ? { tools } : {}),
				max_tokens: 4096,
				stream: true,
			});

			// @ts-ignore - Anthropic stream typing issue
			for await (const event of stream) {
				if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
					const chunk = event.delta.text;
					fullContent += chunk;

					// Debug log the chunk being emitted
					logger.debug('Streaming chunk (Anthropic):', {
						chunk,
						fullContentSoFar: fullContent.slice(0, 50) + '...',
						sessionId,
					});

					// Emit chunk event for real-time streaming
					if (this.eventManager) {
						this.eventManager.emitSessionEvent(sessionId, SessionEvents.LLM_RESPONSE_CHUNK, {
							sessionId,
							messageId,
							chunk,
							text: chunk,
							isComplete: false,
							timestamp: Date.now(),
						});
					}
				}
			}

			// Update response object with full content
			response.content = [{ type: 'text', text: fullContent }];

			// Emit completion event for streaming
			if (this.eventManager) {
				this.eventManager.emitSessionEvent(sessionId, SessionEvents.LLM_RESPONSE_COMPLETED, {
					sessionId,
					messageId,
					model: this.model,
					content: fullContent,
					response: fullContent,
					timestamp: Date.now(),
				});
			}

			return { response, fullContent };
		} catch (error) {
			logger.error('Error in streaming response:', error);
			throw error;
		}
	}

	/**
	 * Determines if an error is retryable based on status code and error type
	 */
	private isRetryableError(status: number, errorType: string): boolean {
		// Non-retryable errors
		if (status === 400 || status === 401 || status === 403 || status === 404) {
			return false;
		}

		if (errorType === 'invalid_request_error' || errorType === 'authentication_error') {
			return false;
		}

		// Retryable errors: 429, 500, 502, 503, 504, 529, network errors, etc.
		return status >= 429 || status >= 500 || errorType === 'overloaded_error' || !status;
	}

	/**
	 * Calculates retry delay with exponential backoff and jitter
	 */
	private calculateRetryDelay(attempt: number, status: number, errorType: string): number {
		let baseDelay = 1000; // Base delay of 1 second

		// Special handling for overloaded errors (529)
		if (status === 529 || errorType === 'overloaded_error') {
			baseDelay = 3000; // Start with 3 seconds for overloaded errors
		}

		// Exponential backoff: 2^attempt * baseDelay
		const exponentialDelay = Math.pow(2, attempt - 1) * baseDelay;

		// Add jitter (random factor between 0.5 and 1.5)
		const jitter = 0.5 + Math.random();
		const finalDelay = Math.min(exponentialDelay * jitter, 30000); // Cap at 30 seconds

		return Math.round(finalDelay);
	}

	private formatToolsForAnthropic(tools: ToolSet): any[] {
		// Convert the ToolSet object to an array of tools in Anthropic's format
		return Object.entries(tools).map(([toolName, tool]) => {
			const input_schema: { type: string; properties: any; required: string[] } = {
				type: 'object',
				properties: {},
				required: [],
			};

			// Map tool parameters to JSON Schema format
			if (tool.parameters) {
				// The actual parameters structure appears to be a JSON Schema object
				const jsonSchemaParams = tool.parameters as any;

				if (jsonSchemaParams.type === 'object' && jsonSchemaParams.properties) {
					input_schema.properties = jsonSchemaParams.properties;
					if (Array.isArray(jsonSchemaParams.required)) {
						input_schema.required = jsonSchemaParams.required;
					}
				} else {
					logger.warn(`Unexpected parameters format for tool ${toolName}:`, jsonSchemaParams);
				}
			} else {
				// Handle case where tool might have no parameters
				logger.debug(`Tool ${toolName} has no defined parameters.`);
			}

			return {
				name: toolName,
				description: tool.description,
				input_schema: input_schema,
			};
		});
	}
}
