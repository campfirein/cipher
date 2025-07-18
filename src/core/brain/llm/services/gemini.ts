import { ToolSet } from '../../../mcp/types.js';
import { MCPManager } from '../../../mcp/manager.js';
import { UnifiedToolManager, CombinedToolSet } from '../../tools/unified-tool-manager.js';
import { ContextManager } from '../messages/manager.js';
import { ImageData } from '../messages/types.js';
import { ILLMService, LLMServiceConfig } from './types.js';
import { logger } from '../../../logger/index.js';
import { formatToolResult } from '../utils/tool-result-formatter.js';
import { GoogleGenAI } from '@google/genai';

export class GeminiService implements ILLMService {
	private ai: GoogleGenAI;
	private model: string;
	private mcpManager: MCPManager;
	private unifiedToolManager: UnifiedToolManager | undefined;
	private contextManager: ContextManager;
	private maxIterations: number;

	constructor(
		ai: GoogleGenAI,
		model: string,
		mcpManager: MCPManager,
		contextManager: ContextManager,
		maxIterations: number = 5,
		unifiedToolManager?: UnifiedToolManager
	) {
		this.ai = ai;
		this.model = model;
		this.mcpManager = mcpManager;
		this.unifiedToolManager = unifiedToolManager;
		this.contextManager = contextManager;
		this.maxIterations = maxIterations;
	}

	async generate(userInput: string, imageData?: ImageData): Promise<string> {
		await this.contextManager.addUserMessage(userInput, imageData);
		
		let formattedTools: any[];
		if (this.unifiedToolManager) {
			// Use 'gemini' as the provider for Gemini tool formatting
			formattedTools = await this.unifiedToolManager.getToolsForProvider('gemini');
		} else {
			const rawTools = await this.mcpManager.getAllTools();
			formattedTools = this.formatToolsForGemini(rawTools);
		}
		
		logger.silly(`Formatted tools: ${JSON.stringify(formattedTools, null, 2)}`);
		
		let iterationCount = 0;
		try {
			while (iterationCount < this.maxIterations) {
				iterationCount++;
				
				// Get AI response with retry logic
				const { response } = await this.getAIResponseWithRetries(formattedTools, userInput);
				
				// Extract text content and function calls from response
				const textContent = response.text;
				const functionCalls = response.functionCalls || [];
				
				logger.debug('Extracted text content:', textContent);
				logger.debug('Extracted function calls:', functionCalls);
				
				// If there are no function calls, we're done
				if (functionCalls.length === 0) {
					await this.contextManager.addAssistantMessage(textContent);
					return textContent;
				}
				
				// Log thinking steps when assistant provides reasoning before function calls
				if (textContent && textContent.trim()) {
					logger.info(`💭 ${textContent.trim()}`);
				}
				
				// Convert function calls to tool calls format for context manager
				const toolCalls = functionCalls.map((fc: any, index: number) => ({
					id: `call_${Date.now()}_${index}`,
					type: 'function' as const,
					function: {
						name: fc.name,
						arguments: JSON.stringify(fc.args)
					}
				}));
				
				// Add assistant message with tool calls to history
				await this.contextManager.addAssistantMessage(textContent, toolCalls);
				
				// Handle function calls
				for (let i = 0; i < functionCalls.length; i++) {
					const functionCall = functionCalls[i];
					const toolCall = toolCalls[i];
					
					logger.debug(`Function call initiated: ${JSON.stringify(functionCall, null, 2)}`);
					logger.info(`🔧 Using tool: ${functionCall.name}`);
					
					const toolName = functionCall.name;
					const args = functionCall.args || {};
					
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
			const finalResponse = 'Task completed but reached maximum function call iterations.';
			await this.contextManager.addAssistantMessage(finalResponse);
			return finalResponse;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(`Error in Gemini service API call: ${errorMessage}`, { error });
			await this.contextManager.addAssistantMessage(`Error processing request: ${errorMessage}`);
			return `Error processing request: ${errorMessage}`;
		}
	}

	async directGenerate(userInput: string, systemPrompt?: string): Promise<string> {
		try {
			logger.debug('GeminiService: Direct generate call (bypassing conversation context)', {
				inputLength: userInput.length,
				hasSystemPrompt: !!systemPrompt,
			});
			
			const response = await this.ai.models.generateContent({
				model: this.model,
				contents: [{ role: 'user', parts: [{ text: userInput }] }],
			});
			
			const textContent = response.text;
			
			logger.debug('GeminiService: Direct generate completed', {
				responseLength: textContent.length,
			});
			return textContent;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('GeminiService: Direct generate failed', {
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
			provider: 'gemini',
			model: this.model,
		};
	}

	private async getAIResponseWithRetries(
		tools: any[],
		userInput: string
	): Promise<{ response: any }> {
		let attempts = 0;
		const MAX_ATTEMPTS = 3;
		logger.debug(`Tools in response: ${tools.length}`);
		while (attempts < MAX_ATTEMPTS) {
			attempts++;
			try {
				const formattedMessages = await this.contextManager.getFormattedMessage({
					role: 'user',
					content: userInput,
				});
				logger.debug(`Sending ${formattedMessages.length} formatted messages to Gemini:`, {
					messages: formattedMessages.map((msg: any, idx: number) => ({
						index: idx,
						role: msg.role,
						hasContent: !!msg.content,
						toolCallId: msg.tool_call_id,
						name: msg.name,
					})),
				});
				logger.debug('Full formatted messages:', JSON.stringify(formattedMessages, null, 2));
				logger.debug('Formatted messages length:', formattedMessages.length);
				if (formattedMessages.length > 0) {
					logger.debug('First message structure:', JSON.stringify(formattedMessages[0], null, 2));
				}
				
				// For Gemini, we use the new @google/genai API with function calling support
				const generationConfig: any = {
					model: this.model,
					contents: formattedMessages,
				};
				
				// Add tools if available (only on first attempt)
				if (attempts === 1 && tools.length > 0) {
					generationConfig.config = {
						tools: tools,
						toolConfig: {
							functionCallingConfig: {
								mode: 'ANY', // Force function calling when tools are available
							}
						}
					};
				}
				
				const response = await this.ai.models.generateContent(generationConfig);
				logger.silly('GEMINI GENERATE CONTENT RESPONSE: ', JSON.stringify(response, null, 2));
				return { response };
			} catch (error) {
				const apiError = error as any;
				logger.error(
					`Error in Gemini API call (Attempt ${attempts}/${MAX_ATTEMPTS}): ${apiError.message || JSON.stringify(apiError, null, 2)}`
				);
				if (attempts >= MAX_ATTEMPTS || !this.isRetryableError(apiError)) {
					throw apiError;
				}
				const delay = this.calculateRetryDelay(attempts);
				logger.info(
					`Retrying Gemini API call in ${delay}ms... (Attempt ${attempts + 1}/${MAX_ATTEMPTS})`
				);
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
		throw new Error('Gemini API call failed after maximum retry attempts');
	}

	private isRetryableError(error: any): boolean {
		if (!error) return false;
		const status = error.status || error.code;
		return status === 429 || status === 500 || status === 503 || status === 504;
	}

	private calculateRetryDelay(attempt: number): number {
		const baseDelay = 500;
		const maxDelay = 5000;
		const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
		return delay + Math.floor(Math.random() * 200);
	}

	private formatToolsForGemini(tools: ToolSet): any[] {
		// Convert ToolSet object to array for new @google/genai API
		// The new API expects functionDeclarations in a specific format
		const functionDeclarations = Object.entries(tools).map(([name, tool]) => ({
			name,
			description: tool.description,
			parametersJsonSchema: tool.parameters
		}));
		
		return [{
			functionDeclarations
		}];
	}
}
