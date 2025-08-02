import { ToolSet } from '../../../mcp/types.js';
import { MCPManager } from '../../../mcp/manager.js';
import { UnifiedToolManager, CombinedToolSet } from '../../tools/unified-tool-manager.js';
import { ContextManager } from '../messages/manager.js';
import { ImageData } from '../messages/types.js';
import { ILLMService, LLMServiceConfig } from './types.js';
// Fix OpenAI import for compatibility
// @ts-ignore

const OpenAI = require('openai');
import { logger } from '../../../logger/index.js';
import { formatToolResult } from '../utils/tool-result-formatter.js';

export interface QwenOptions {
	enableThinking?: boolean;
	thinkingBudget?: number;
	[key: string]: any;
}

export class QwenService implements ILLMService {
	private openai: any;
	private model: string;
	private mcpManager: MCPManager;
	private unifiedToolManager: UnifiedToolManager | undefined;
	private contextManager: ContextManager;
	private maxIterations: number;
	private qwenOptions: QwenOptions;

	constructor(
		openai: any,
		model: string,
		mcpManager: MCPManager,
		contextManager: ContextManager,
		maxIterations: number = 5,
		qwenOptions: QwenOptions = {},
		unifiedToolManager?: UnifiedToolManager
	) {
		this.openai = openai;
		this.model = model;
		this.mcpManager = mcpManager;
		this.unifiedToolManager = unifiedToolManager;
		this.contextManager = contextManager;
		this.maxIterations = maxIterations;
		this.qwenOptions = qwenOptions;
	}

	async generate(userInput: string, imageData?: ImageData, sessionId?: string): Promise<string> {
		await this.contextManager.addUserMessage(userInput, imageData);

		let formattedTools: any[] = [];
		if (this.unifiedToolManager) {
			// Use 'qwen' for Qwen-specific tool formatting
			formattedTools = (await this.unifiedToolManager.getToolsForProvider('qwen')) || [];
		} else {
			const rawTools = await this.mcpManager.getAllTools();
			formattedTools = this.formatToolsForOpenAI(rawTools) || [];
		}

		logger.silly(`[Qwen] Formatted tools: ${JSON.stringify(formattedTools, null, 2)}`);

		let iterationCount = 0;
		try {
			while (iterationCount < this.maxIterations) {
				iterationCount++;
				const { message } = await this.getAIResponseWithRetries(formattedTools, userInput, false);

				if (
					!message.tool_calls ||
					!Array.isArray(message.tool_calls) ||
					message.tool_calls.length === 0
				) {
					const responseText = message.content || '';
					await this.contextManager.addAssistantMessage(responseText);
					return responseText;
				}

				if (message.content && message.content.trim()) {
					logger.info(`[Qwen] 💭 ${message.content.trim()}`);
				}

				await this.contextManager.addAssistantMessage(message.content, message.tool_calls);

				for (const toolCall of message.tool_calls) {
					logger.debug(`[Qwen] Tool call initiated: ${JSON.stringify(toolCall, null, 2)}`);
					logger.info(`[Qwen] 🔧 Using tool: ${toolCall.function.name}`);
					const toolName = toolCall.function.name;
					let args: any = {};

					try {
						args = JSON.parse(toolCall.function.arguments);
					} catch (e) {
						logger.error(`[Qwen] Error parsing arguments for ${toolName}:`, e);
						await this.contextManager.addToolResult(toolCall.id, toolName, {
							error: `Failed to parse arguments: ${e}`,
						});
						continue;
					}

					try {
						let result: any;
						if (this.unifiedToolManager) {
							result = await this.unifiedToolManager.executeTool(toolName, args);
						} else {
							result = await this.mcpManager.executeTool(toolName, args);
						}
						const formattedResult = formatToolResult(toolName, result);
						logger.info(`[Qwen] 📋 Tool Result:\n${formattedResult}`);
						await this.contextManager.addToolResult(toolCall.id, toolName, result);
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						logger.error(`[Qwen] Tool execution error for ${toolName}: ${errorMessage}`);
						await this.contextManager.addToolResult(toolCall.id, toolName, {
							error: errorMessage,
						});
					}
				}
			}
			logger.warn(`[Qwen] Reached maximum iterations (${this.maxIterations}) for task.`);
			const finalResponse = 'Task completed but reached maximum tool call iterations.';
			await this.contextManager.addAssistantMessage(finalResponse);
			return finalResponse;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(`[Qwen] Error in Qwen service API call: ${errorMessage}`, { error });
			await this.contextManager.addAssistantMessage(
				`[Qwen] Error processing request: ${errorMessage}`
			);
			return `[Qwen] Error processing request: ${errorMessage}`;
		}
	}

	async directGenerate(userInput: string, systemPrompt?: string): Promise<string> {
		try {
			logger.debug('[QwenService] Direct generate call (bypassing conversation context)', {
				inputLength: userInput.length,
				hasSystemPrompt: !!systemPrompt,
			});
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
			// Transform qwenOptions to API format (camelCase to snake_case) for direct generate
			const apiOptions: any = {};

			// Always set enable_thinking explicitly for non-streaming calls
			// Qwen API requires this to be explicitly set to false for non-streaming calls
			apiOptions.enable_thinking = this.qwenOptions.enableThinking ?? false;

			if (this.qwenOptions.thinkingBudget !== undefined) {
				apiOptions.thinking_budget = this.qwenOptions.thinkingBudget;
			}
			if (this.qwenOptions.temperature !== undefined) {
				apiOptions.temperature = this.qwenOptions.temperature;
			}
			if (this.qwenOptions.top_p !== undefined) {
				apiOptions.top_p = this.qwenOptions.top_p;
			}

			const response = await this.openai.chat.completions.create({
				model: this.model,
				messages: messages,
				...apiOptions,
			});
			const responseText = response.choices[0]?.message?.content || '';
			logger.debug('[QwenService] Direct generate completed', {
				responseLength: responseText.length,
			});
			return responseText;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('[QwenService] Direct generate failed', {
				error: errorMessage,
				inputLength: userInput.length,
			});
			throw new Error(`[QwenService] Direct generate failed: ${errorMessage}`);
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
			provider: 'qwen',
			model: this.model,
		};
	}

	private async getAIResponseWithRetries(
		tools: any[],
		userInput: string,
		stream?: boolean
	): Promise<{ message: any }> {
		let attempts = 0;
		const MAX_ATTEMPTS = 3;
		logger.debug(`[Qwen] Tools in response: ${tools?.length || 0}`);
		while (attempts < MAX_ATTEMPTS) {
			attempts++;
			try {
				const formattedMessages = await this.contextManager.getFormattedMessage({
					role: 'user',
					content: userInput,
				});
				logger.debug(`[Qwen] Sending ${formattedMessages.length} formatted messages to Qwen:`, {
					messages: formattedMessages.map((msg, idx) => ({
						index: idx,
						role: msg.role,
						hasContent: !!msg.content,
						hasToolCalls: !!msg.tool_calls,
						toolCallId: msg.tool_call_id,
						name: msg.name,
					})),
				});
				// Transform qwenOptions to API format (camelCase to snake_case)
				const apiOptions: any = {};

				// Always set enable_thinking explicitly for non-streaming calls
				// Qwen API requires this to be explicitly set to false for non-streaming calls
				apiOptions.enable_thinking = this.qwenOptions.enableThinking ?? false;

				if (this.qwenOptions.thinkingBudget !== undefined) {
					apiOptions.thinking_budget = this.qwenOptions.thinkingBudget;
				}
				if (this.qwenOptions.temperature !== undefined) {
					apiOptions.temperature = this.qwenOptions.temperature;
				}
				if (this.qwenOptions.top_p !== undefined) {
					apiOptions.top_p = this.qwenOptions.top_p;
				}

				// Debug logging to see what's being sent
				logger.debug('[Qwen] QwenOptions being sent to API:', {
					qwenOptions: this.qwenOptions,
					apiOptions: apiOptions,
					enableThinking: this.qwenOptions.enableThinking,
					enable_thinking: apiOptions.enable_thinking,
				});

				const requestBody: any = {
					model: this.model,
					messages: formattedMessages,
					tools: attempts === 1 ? tools || [] : [],
					tool_choice: attempts === 1 ? 'auto' : 'none',
					...apiOptions,
				};
				if (stream !== undefined) {
					requestBody.stream = stream;
				}
				const response = await this.openai.chat.completions.create(requestBody);
				logger.silly('[Qwen] QWEN CHAT COMPLETION RESPONSE: ', JSON.stringify(response, null, 2));
				const message = response.choices[0]?.message;
				if (!message) {
					throw new Error('[Qwen] Received empty message from Qwen API');
				}
				return { message };
			} catch (error) {
				const apiError = error as any;
				logger.error(
					`[Qwen] Error in Qwen API call (Attempt ${attempts}/${MAX_ATTEMPTS}): ${apiError.message || JSON.stringify(apiError, null, 2)}`,
					{ status: apiError.status, headers: apiError.headers }
				);
				if (apiError.status === 400 && apiError.error?.code === 'context_length_exceeded') {
					logger.warn(
						`[Qwen] Context length exceeded. ContextManager compression might not be sufficient. Error details: ${JSON.stringify(apiError.error)}`
					);
				}
				if (attempts >= MAX_ATTEMPTS) {
					logger.error(`[Qwen] Failed to get response from Qwen after ${MAX_ATTEMPTS} attempts.`);
					throw error;
				}
				await new Promise(resolve => setTimeout(resolve, 500 * attempts));
			}
		}
		throw new Error('[Qwen] Failed to get response after maximum retry attempts');
	}

	private formatToolsForOpenAI(tools: ToolSet): any[] {
		if (!tools || typeof tools !== 'object') {
			return [];
		}
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
