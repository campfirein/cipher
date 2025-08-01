import { GoogleGenerativeAI, GenerativeModel, ChatSession } from '@google/generative-ai';
import { ILLMService } from './types.js';
import { ImageData } from '../messages/types.js';
import { MCPManager } from '../../../mcp/manager.js';
import { UnifiedToolManager } from '../../tools/unified-tool-manager.js';
import { ContextManager } from '../messages/manager.js';
import { logger } from '../../../logger/index.js';
import { formatToolResult } from '../utils/tool-result-formatter.js';

export class GeminiService implements ILLMService {
	private genAI: GoogleGenerativeAI;
	private model: GenerativeModel;
	private modelName: string;
	private mcpManager: MCPManager;
	private contextManager: ContextManager;
	private maxIterations: number;
	private unifiedToolManager: UnifiedToolManager | null = null;

	constructor(
		apiKey: string,
		modelName: string,
		mcpManager: MCPManager,
		contextManager: ContextManager,
		maxIterations: number = 50,
		unifiedToolManager?: UnifiedToolManager
	) {
		try {
			this.genAI = new GoogleGenerativeAI(apiKey);
			this.modelName = modelName;
			this.mcpManager = mcpManager;
			this.contextManager = contextManager;
			this.maxIterations = maxIterations;
			this.unifiedToolManager = unifiedToolManager || null;

			// Initialize the model
			this.model = this.genAI.getGenerativeModel({ model: modelName });

			logger.debug('Gemini service initialized successfully', {
				model: modelName,
				hasUnifiedToolManager: !!unifiedToolManager,
			});
		} catch (error) {
			logger.error('Failed to initialize Gemini service', {
				error: error instanceof Error ? error.message : String(error),
				model: modelName,
			});
			throw error;
		}
	}

	async generate(userInput: string, imageData?: ImageData, stream?: boolean): Promise<string> {
		await this.contextManager.addUserMessage(userInput, imageData);

		// Use unified tool manager if available, otherwise fall back to MCP manager
		let formattedTools: any[];
		if (this.unifiedToolManager) {
			formattedTools = await this.unifiedToolManager.getToolsForProvider('gemini');
		} else {
			const rawTools = await this.mcpManager.getAllTools();
			formattedTools = this.formatToolsForGemini(rawTools);
		}

		logger.silly(`Formatted tools for Gemini: ${JSON.stringify(formattedTools, null, 2)}`);

		let iterationCount = 0;
		let toolsUsedInThisConversation = false;

		try {
			while (iterationCount < this.maxIterations) {
				iterationCount++;

				// Check if tools have already been used in this conversation
				const conversationHistory = await this.contextManager.getAllFormattedMessages();
				const hasToolCallsInHistory = conversationHistory.some(
					msg => msg.tool_calls && msg.tool_calls.length > 0
				);

				if (hasToolCallsInHistory) {
					toolsUsedInThisConversation = true;
				}

				// Attempt to get a response, with retry logic
				const { message } = await this.getAIResponseWithRetries(
					formattedTools,
					userInput,
					toolsUsedInThisConversation
				);

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
					logger.debug(`Gemini tool call initiated: ${JSON.stringify(toolCall, null, 2)}`);
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

						// Mark that tools have been used
						toolsUsedInThisConversation = true;
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
			logger.error(`Error in Gemini service API call: ${errorMessage}`, { error });
			await this.contextManager.addAssistantMessage(`Error processing request: ${errorMessage}`);
			return `Error processing request: ${errorMessage}`;
		}
	}

	async directGenerate(prompt: string): Promise<string> {
		try {
			logger.debug('Gemini service direct generation', {
				model: this.modelName,
				promptLength: prompt.length,
			});

			const result = await this.model.generateContent(prompt);
			const response = result.response.text();

			logger.debug('Gemini service direct response generated', {
				responseLength: response.length,
			});

			return response;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('Error in Gemini service direct generation', {
				error: errorMessage,
				model: this.modelName,
			});
			throw new Error(`Gemini direct generation failed: ${errorMessage}`);
		}
	}

	async getAllTools(): Promise<Record<string, any>> {
		const mcpTools = await this.mcpManager.getAllTools();
		const internalTools = this.unifiedToolManager
			? await this.unifiedToolManager.getAllTools()
			: {};

		return {
			...mcpTools,
			...internalTools,
		};
	}

	getConfig(): { provider: string; model: string } {
		return {
			provider: 'gemini',
			model: this.modelName,
		};
	}

	// Helper methods
	private async getAIResponseWithRetries(
		tools: any[],
		userInput: string,
		toolsUsedInHistory: boolean
	): Promise<{ message: any }> {
		let attempts = 0;
		const MAX_ATTEMPTS = 3;

		// Add a log of the number of tools in response
		logger.debug(`Tools in Gemini response: ${tools.length}`);

		while (attempts < MAX_ATTEMPTS) {
			attempts++;
			try {
				// Use the new method that implements proper flow: get system prompt, compress history, format messages
				const formattedMessages = await this.contextManager.getFormattedMessage({
					role: 'user',
					content: userInput,
				});

				// Debug log: Show exactly what messages are being sent to Gemini
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

				// Convert messages to Gemini format and create prompt
				const prompt = this.convertMessagesToPrompt(formattedMessages);

				// Add tool information to the prompt if tools are available and haven't been used yet
				let finalPrompt = prompt;
				if (attempts === 1 && tools.length > 0 && !toolsUsedInHistory) {
					finalPrompt = this.addToolsToPrompt(prompt, tools);
				} else if (toolsUsedInHistory) {
					// If tools have already been used, add instruction to provide final response
					finalPrompt = `${prompt}

IMPORTANT: Tools have already been used in this conversation. Please provide a final response based on the tool results that are already available. Do NOT make any additional tool calls.

CONVERSATION STYLE:
While you are primarily a programming assistant, you can engage in general conversation topics when appropriate. You don't need to restrict yourself to only programming discussions. Feel free to discuss various topics including sports, general knowledge, and other subjects when the user asks about them.`;
				}

				// Call Gemini API
				const result = await this.model.generateContent(finalPrompt);
				const response = result.response;
				const rawText = response.text();

				// Parse the response to extract tool calls
				const parsedResponse = this.parseGeminiResponse(rawText);

				logger.silly('GEMINI GENERATE CONTENT RESPONSE: ', JSON.stringify(parsedResponse, null, 2));

				// Get the response message
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

				// Wait before retrying
				await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
			}
		}

		throw new Error('Gemini API call failed after all retry attempts');
	}

	private convertMessagesToPrompt(messages: any[]): string {
		logger.debug('convertMessagesToPrompt called with:', {
			messagesType: typeof messages,
			isArray: Array.isArray(messages),
			length: messages?.length,
			messages: messages,
		});

		if (!Array.isArray(messages) || messages.length === 0) {
			logger.debug('convertMessagesToPrompt returning empty string - no valid messages');
			return '';
		}

		const result = messages
			.filter(msg => msg && (msg.content || msg.role)) // Filter out invalid messages
			.map(msg => {
				// Handle different content formats
				let content = '';
				if (typeof msg.content === 'string') {
					content = msg.content;
				} else if (typeof msg.content === 'object' && msg.content !== null) {
					content = JSON.stringify(msg.content);
				} else if (typeof msg === 'string') {
					// Handle case where the message itself is a string
					return msg;
				} else {
					content = String(msg.content || '');
				}

				// Format based on role
				if (msg.role === 'system') {
					return `System: ${content}`;
				} else if (msg.role === 'user') {
					return `User: ${content}`;
				} else if (msg.role === 'assistant') {
					return `Assistant: ${content}`;
				} else {
					// Default formatting
					return content;
				}
			})
			.filter(line => line.trim().length > 0) // Remove empty lines
			.join('\n\n');

		logger.debug('convertMessagesToPrompt result:', {
			resultType: typeof result,
			resultLength: result?.length || 0,
			result: result,
		});

		// Ensure we always return a string
		return result || '';
	}

	private addToolsToPrompt(prompt: string, tools: any[]): string {
		const toolDescriptions = tools
			.map(tool => {
				const func = tool.function;
				const params = func.parameters ? JSON.stringify(func.parameters, null, 2) : '{}';
				return `Tool: ${func.name}
Description: ${func.description}
Parameters: ${params}`;
			})
			.join('\n\n');

		return `${prompt}

IMPORTANT: You have access to the following tools. If the user's request requires using any of these tools, you MUST respond with a tool call in the exact format shown below.

Available tools:
${toolDescriptions}

TOOL CALLING FORMAT:
When you need to use a tool, respond with ONLY the tool call in this exact format:

\`\`\`tool_code
{
  "tool": "tool_name",
  "arguments": {
    "param1": "value1",
    "param2": "value2"
  }
}
\`\`\`

CRITICAL RULES:
1. If the user asks to search for information, use the appropriate search tool ONCE
2. If the user asks to store or save information, use the appropriate storage tool ONCE
3. After using a tool, provide a final response based on the tool results - DO NOT make additional tool calls
4. Only respond with a tool call if you need to use a tool
5. If you don't need to use any tools, provide a direct response
6. NEVER include both a tool call and regular text in the same response
7. NEVER make multiple tool calls for the same request - one tool call maximum per user request

CONVERSATION STYLE:
While you are primarily a programming assistant, you can engage in general conversation topics when appropriate. You don't need to restrict yourself to only programming discussions. Feel free to discuss various topics including sports, general knowledge, and other subjects when the user asks about them.

For the current request, determine if you need to use any tools and respond accordingly. If you've already used a tool in a previous response, provide a final answer based on those results.`;
	}

	private parseGeminiResponse(text: string): any {
		// Look for tool calls in the response first
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
				logger.warn('Failed to parse tool call from Gemini response', {
					toolCallText: match[1],
					error: e instanceof Error ? e.message : String(e),
				});
			}
		}

		// Extract text content (everything except tool calls)
		let textContent = '';
		if (toolCalls.length > 0) {
			// If we found tool calls, extract text before the first tool call
			const firstToolCallIndex = text.search(/```tool_code/);
			if (firstToolCallIndex > 0) {
				textContent = text.substring(0, firstToolCallIndex).trim();
			}
		} else {
			// No tool calls found, use the cleaned text
			textContent = this.cleanToolMetadata(text);
		}

		// CRITICAL FIX: If there's significant text content AND tool calls,
		// prioritize the text content and ignore tool calls to prevent redundant calls
		if (textContent.trim().length > 20 && toolCalls.length > 0) {
			logger.debug(
				'Gemini response contains both text and tool calls - prioritizing text to prevent redundant calls',
				{
					textContentLength: textContent.length,
					toolCallCount: toolCalls.length,
					textPreview: textContent.substring(0, 100),
				}
			);

			// Return only the text content, no tool calls
			return {
				content: textContent,
				tool_calls: undefined,
			};
		}

		// Log what we found
		logger.debug('Parsed Gemini response:', {
			hasToolCalls: toolCalls.length > 0,
			toolCallCount: toolCalls.length,
			textContentLength: textContent.length,
			toolCalls: toolCalls.map(tc => tc.function.name),
		});

		return {
			content: textContent,
			tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
		};
	}

	/**
	 * Clean tool-related metadata from Gemini responses
	 * Removes code blocks containing tool instructions that shouldn't be shown to users
	 */
	private cleanToolMetadata(text: string): string {
		if (!text) return text;

		// Remove all tool_code blocks regardless of content
		// These are metadata that shouldn't be shown to users
		const toolCodePattern = /```tool_code\s*\n?[^`]*\n?```\s*/gi;
		let cleaned = text.replace(toolCodePattern, '');

		// Remove any standalone tool instruction comments
		const toolCommentPattern = /^\s*#\s*(No tools needed|Tool:|Query:).*$/gm;
		cleaned = cleaned.replace(toolCommentPattern, '');

		// Remove empty lines that might be left after cleaning
		cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');

		// Trim leading/trailing whitespace
		cleaned = cleaned.trim();

		return cleaned;
	}

	private formatToolsForGemini(tools: Record<string, any>): any[] {
		// Convert the ToolSet object to an array of tools in Gemini's format
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
