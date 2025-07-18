import { IMessageFormatter } from './formatters/types.js';
import { logger } from '../../../logger/index.js';
import { InternalMessage, ImageData } from './types.js';
import { getImageData } from './utils.js';
import { PromptManager } from '../../../brain/systemPrompt/manager.js';
import { IConversationHistoryProvider } from './history/types.js';

export class ContextManager {
	private promptManager: PromptManager;
	private formatter: IMessageFormatter;
	private historyProvider: IConversationHistoryProvider | undefined;
	private sessionId: string | undefined;
	private messages: InternalMessage[] = [];
	private fallbackToMemory: boolean = false;

	constructor(
		formatter: IMessageFormatter,
		promptManager: PromptManager,
		historyProvider: IConversationHistoryProvider | undefined,
		sessionId: string | undefined
	) {
		if (!formatter) throw new Error('formatter is required');
		this.formatter = formatter;
		this.promptManager = promptManager;
		this.historyProvider = historyProvider;
		this.sessionId = sessionId;
		logger.debug('ContextManager initialized with formatter', { formatter });
	}

	async getSystemPrompt(): Promise<string> {
		const prompt = await this.promptManager.getCompleteSystemPrompt();
		logger.debug(`[SystemPrompt] Built complete system prompt:\n${prompt}`);
		return prompt;
	}

	async addMessage(message: InternalMessage): Promise<void> {
		if (!message.role) {
			throw new Error('Role is required for a message');
		}
		switch (message.role) {
			case 'user':
				if (
					!(Array.isArray(message.content) && message.content.length > 0) &&
					(typeof message.content !== 'string' || message.content.trim() === '')
				) {
					throw new Error(
						'User message content should be a non-empty string or a non-empty array of parts.'
					);
				}
				break;
			case 'assistant':
				if (message.content === null && (!message.toolCalls || message.toolCalls.length === 0)) {
					throw new Error('Assistant message must have content or toolCalls.');
				}
				if (message.toolCalls) {
					if (
						!Array.isArray(message.toolCalls) ||
						message.toolCalls.some(tc => !tc.id || !tc.function?.name || !tc.function?.arguments)
					) {
						throw new Error('Invalid toolCalls structure in assistant message.');
					}
				}
				break;
			case 'tool':
				if (!message.toolCallId || !message.name || message.content === null) {
					throw new Error('Tool message missing required fields (toolCallId, name, content).');
				}
				break;
			case 'system':
				if (typeof message.content !== 'string' || message.content.trim() === '') {
					throw new Error('System message content must be a non-empty string.');
				}
				break;
			default:
				throw new Error(`Unknown message role: ${(message as any).role}`);
		}

		// Store the message in persistent history if available, else fallback to memory
		if (this.historyProvider && this.sessionId && !this.fallbackToMemory) {
			try {
				await this.historyProvider.saveMessage(this.sessionId, message);
				this.messages.push(message); // Keep in-memory for fast access in this instance
			} catch (err) {
				logger.error(`History provider failed, falling back to in-memory: ${err}`);
				this.fallbackToMemory = true;
				this.messages.push(message);
			}
		} else {
			this.messages.push(message);
		}
		logger.debug(`Adding message to context: ${JSON.stringify(message, null, 2)}`);
		logger.debug(`Total messages in context: ${this.messages.length}`);
	}

	async restoreHistory(): Promise<void> {
		if (this.historyProvider && this.sessionId) {
			try {
				this.messages = await this.historyProvider.getHistory(this.sessionId);
				logger.debug(`Restored ${this.messages.length} messages from persistent history.`);
			} catch (err) {
				logger.error(`Failed to restore history from provider: ${err}`);
				this.fallbackToMemory = true;
			}
		}
	}

	async addUserMessage(textContent: string, imageData?: ImageData): Promise<void> {
		if (typeof textContent !== 'string' || textContent.trim() === '') {
			throw new Error('Content must be a non-empty string.');
		}
		const messageParts: InternalMessage['content'] = imageData
			? [
					{ type: 'text', text: textContent },
					{
						type: 'image',
						image: imageData.image,
						mimeType: imageData.mimeType || 'image/jpeg',
					},
				]
			: [{ type: 'text', text: textContent }];
		logger.debug(`Adding user message: ${JSON.stringify(messageParts, null, 2)}`);
		await this.addMessage({ role: 'user', content: messageParts });
	}

	async addAssistantMessage(
		content: string | null,
		toolCalls?: InternalMessage['toolCalls']
	): Promise<void> {
		if (content === null && (!toolCalls || toolCalls.length === 0)) {
			throw new Error('Must provide content or toolCalls.');
		}
		await this.addMessage({
			role: 'assistant' as const,
			content,
			...(toolCalls && toolCalls.length > 0 && { toolCalls }),
		});
	}

	async addToolResult(toolCallId: string, name: string, result: any): Promise<void> {
		if (!toolCallId || !name) {
			throw new Error('addToolResult: toolCallId and name are required.');
		}
		let content: InternalMessage['content'];
		if (result && typeof result === 'object' && 'image' in result) {
			const imagePart = result as {
				image: string | Uint8Array | Buffer | ArrayBuffer | URL;
				mimeType?: string;
			};
			content = [
				{
					type: 'image',
					image: getImageData(imagePart),
					mimeType: imagePart.mimeType || 'image/jpeg',
				},
			];
		} else if (typeof result === 'string') {
			content = result;
		} else if (Array.isArray(result)) {
			content = result;
		} else {
			content = JSON.stringify(result ?? '');
		}
		await this.addMessage({ role: 'tool', content, toolCallId, name });
	}

	async getFormattedMessage(_message: InternalMessage): Promise<any[]> {
		try {
			return this.getAllFormattedMessages();
		} catch (error) {
			logger.error('Failed to get formatted messages', { error });
			throw new Error(
				`Failed to format message: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	async getAllFormattedMessages(): Promise<any[]> {
		try {
			const prompt = await this.getSystemPrompt();
			const formattedMessages: any[] = [];
			
			// Use the formatter to handle system prompts properly for each provider
			if (prompt) {
				const systemMessage = { role: 'system' as const, content: prompt };
				const formattedSystem = this.formatter.format(systemMessage, null);
				if (Array.isArray(formattedSystem)) {
					formattedMessages.push(...formattedSystem);
				} else if (formattedSystem && formattedSystem !== null) {
					formattedMessages.push(formattedSystem);
				}
			}
			
			for (const msg of this.messages) {
				const formatted = this.formatter.format(msg, null);
				if (Array.isArray(formatted)) {
					formattedMessages.push(...formatted);
				} else if (formatted && formatted !== null) {
					formattedMessages.push(formatted);
				}
			}
			logger.debug(
				`Formatted ${formattedMessages.length} messages from history of ${this.messages.length} messages`
			);
			return formattedMessages;
		} catch (error) {
			logger.error('Failed to format all messages', { error });
			throw new Error(
				`Failed to format messages: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	public getRawMessages(): InternalMessage[] {
		return this.messages;
	}
}
