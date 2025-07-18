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
		
		// Gemini doesn't support function calling, so we'll just get a text response
		try {
			const { response } = await this.getAIResponseWithRetries([], userInput);
			
			// Extract text content from Gemini response
			const candidate = response as any;
			let textContent = '';
			
			logger.debug('Gemini response structure:', JSON.stringify(candidate, null, 2));
			
			// Try different response formats
			if (candidate.response?.candidates?.[0]?.content?.parts) {
				// Standard Gemini response format
				for (const part of candidate.response.candidates[0].content.parts) {
					if (part.text) {
						textContent += part.text;
					}
				}
			} else if (candidate.candidates?.[0]?.content?.parts) {
				// Alternative response format
				for (const part of candidate.candidates[0].content.parts) {
					if (part.text) {
						textContent += part.text;
					}
				}
			} else if (candidate.content?.parts) {
				// Direct content format
				for (const part of candidate.content.parts) {
					if (part.text) {
						textContent += part.text;
					}
				}
			} else if (candidate.text) {
				// Fallback for different response format
				textContent = candidate.text;
			}
			
			logger.debug('Extracted text content:', textContent);
			
			await this.contextManager.addAssistantMessage(textContent);
			return textContent;
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
				logger.debug('Full formatted messages:', JSON.stringify(formattedMessages, null, 2));
				logger.debug('Formatted messages length:', formattedMessages.length);
				if (formattedMessages.length > 0) {
					logger.debug('First message structure:', JSON.stringify(formattedMessages[0], null, 2));
				}
				
				// For Gemini, we only send contents - no tools parameter
				// Gemini doesn't support function calling in the same way as OpenAI
				const response = await this.generativeModel.generateContent({
					contents: formattedMessages,
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
		// Convert ToolSet object to array for Gemini API
		// Gemini expects tools in a different format than OpenAI
		const functionDeclarations = Object.entries(tools).map(([name, tool]) => ({
			name,
			description: tool.description,
			parameters: tool.parameters
		}));
		
		return [{
			functionDeclarations
		}];
	}
}
