import { ToolSet } from '../../../mcp/types.js';
import { MCPManager } from '../../../mcp/manager.js';
import { UnifiedToolManager, CombinedToolSet } from '../../tools/unified-tool-manager.js';
import { ContextManager } from '../messages/manager.js';
import { ImageData } from '../messages/types.js';
import { ILLMService, LLMServiceConfig } from './types.js';
import { logger } from '../../../logger/index.js';
import { formatToolResult } from '../utils/tool-result-formatter.js';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

export class GeminiService implements ILLMService {
	private gemini: GoogleGenerativeAI;
	private model: string;
	private mcpManager: MCPManager;
	private unifiedToolManager: UnifiedToolManager | undefined;
	private contextManager: ContextManager;
	private maxIterations: number;
	private generativeModel: GenerativeModel;

	constructor(
		gemini: GoogleGenerativeAI,
		model: string,
		mcpManager: MCPManager,
		contextManager: ContextManager,
		maxIterations: number = 5,
		unifiedToolManager?: UnifiedToolManager
	) {
		this.gemini = gemini;
		this.model = model;
		this.mcpManager = mcpManager;
		this.unifiedToolManager = unifiedToolManager;
		this.contextManager = contextManager;
		this.maxIterations = maxIterations;
		this.generativeModel = gemini.getGenerativeModel({ model });
	}

	async generate(userInput: string, imageData?: ImageData): Promise<string> {
		await this.contextManager.addUserMessage(userInput, imageData);
		let formattedTools: any[];
		if (this.unifiedToolManager) {
			// Use 'openai' as the provider for Gemini tool formatting
			formattedTools = await this.unifiedToolManager.getToolsForProvider('openai');
		} else {
			const rawTools = await this.mcpManager.getAllTools();
			formattedTools = this.formatToolsForGemini(rawTools);
		}
		logger.silly(`Formatted tools: ${JSON.stringify(formattedTools, null, 2)}`);
		let iterationCount = 0;
		try {
			while (iterationCount < this.maxIterations) {
				iterationCount++;
				const { response } = await this.getAIResponseWithRetries(formattedTools, userInput);
				let textContent = '';
				let toolCalls: any[] = [];
				// Remove all references to response.candidates and use response as candidate
				const candidate = response as any;
				textContent = candidate.content?.parts?.map((p: any) => p.text || '').join('') || '';
				if (candidate.content?.toolCalls) {
					toolCalls = candidate.content.toolCalls;
				}
				if (!toolCalls.length) {
					await this.contextManager.addAssistantMessage(textContent);
					return textContent;
				}
				if (textContent && textContent.trim()) {
					logger.info(`💬 ${textContent.trim()}`);
				}
				await this.contextManager.addAssistantMessage(textContent, toolCalls);
				for (const toolCall of toolCalls) {
					logger.debug(`Tool call initiated: ${JSON.stringify(toolCall, null, 2)}`);
					logger.info(`🔧 Using tool: ${toolCall.functionName}`);
					const toolName = toolCall.functionName;
					let args: any = {};
					try {
						args = toolCall.args;
					} catch (e) {
						logger.error(`Error parsing arguments for ${toolName}:`, e);
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
						logger.info(`📋 Tool Result:\n${formattedResult}`);
						await this.contextManager.addToolResult(toolCall.id, toolName, result);
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						logger.error(`Tool execution error for ${toolName}: ${errorMessage}`);
						await this.contextManager.addToolResult(toolCall.id, toolName, {
							error: errorMessage,
						});
					}
				}
			}
			logger.warn(`Reached maximum iterations (${this.maxIterations}) for task.`);
			const finalResponse = 'Task completed but reached maximum tool call iterations.';
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
			const parts: any[] = [];
			if (systemPrompt) {
				parts.push({ text: systemPrompt });
			}
			parts.push({ text: userInput });
			const response = await this.generativeModel.generateContent({
				contents: [{ role: 'user', parts }],
			});
			// Use response as candidate directly
			const candidate = response as any;
			const textContent = candidate.content?.parts?.map((p: any) => p.text || '').join('') || '';
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
				const response = await this.generativeModel.generateContent({
					contents: formattedMessages,
					tools,
				});
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
		// Convert ToolSet object to array for Gemini
		return Object.entries(tools).map(([name, tool]) => ({
			name,
			description: tool.description,
			parameters: tool.parameters,
		}));
	}
}
