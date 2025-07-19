import { IMessageFormatter } from './formatters/types.js';
import { logger } from '../../../logger/index.js';
import { InternalMessage, ImageData } from './types.js';
import { getImageData } from './utils.js';
import { PromptManager } from '../../../brain/systemPrompt/manager.js';

export class ContextManager {
	private promptManager: PromptManager;
	private formatter: IMessageFormatter;
	private messages: InternalMessage[] = [];

	constructor(formatter: IMessageFormatter, promptManager: PromptManager) {
		if (!formatter) throw new Error('formatter is required');
		this.formatter = formatter;
		this.promptManager = promptManager;
		logger.debug('ContextManager initialized with formatter', { formatter });
	}

	async getSystemPrompt(): Promise<string> {
		// Use the complete system prompt that includes both user instruction and built-in tool instructions
		const prompt = await this.promptManager.getCompleteSystemPrompt();
		logger.debug(`[SystemPrompt] Built complete system prompt:\n${prompt}`);
		return prompt;
	}

	/**
	 * Add a message to the context
	 * @param message - The message to add to the context
	 */
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

		// Store the message in history
		this.messages.push(message);
		logger.debug(`Adding message to context: ${JSON.stringify(message, null, 2)}`);
		logger.debug(`Total messages in context: ${this.messages.length}`);
	}

	/**
	 * Add a user message to the context
	 * @param textContent - The text content of the message
	 * @param imageData - The image data to add to the message
	 */
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

	/**
	 * Add an assistant message to the context
	 * @param content - The content of the message
	 * @param toolCalls - The tool calls to add to the message
	 */
	async addAssistantMessage(
		content: string | null,
		toolCalls?: InternalMessage['toolCalls']
	): Promise<void> {
		// Validate that either content or toolCalls is provided
		if (content === null && (!toolCalls || toolCalls.length === 0)) {
			throw new Error('Must provide content or toolCalls.');
		}
		await this.addMessage({
			role: 'assistant' as const,
			content,
			...(toolCalls && toolCalls.length > 0 && { toolCalls }),
		});
	}

	/**
	 * Add a tool result to the context
	 * @param toolCallId - The ID of the tool call
	 * @param name - The name of the tool
	 * @param result - The result of the tool call
	 */
	async addToolResult(toolCallId: string, name: string, result: any): Promise<void> {
		if (!toolCallId || !name) {
			throw new Error('addToolResult: toolCallId and name are required.');
		}

		// Simplest image detection: if result has an 'image' field, treat as ImagePart
		let content: InternalMessage['content'];
		if (result && typeof result === 'object' && 'image' in result) {
			// Use shared helper to get base64/URL
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
			// Assume array of parts already
			content = result;
		} else {
			// Fallback: stringify all other values
			content = JSON.stringify(result ?? '');
		}

		await this.addMessage({ role: 'tool', content, toolCallId, name });
	}

	/**
	 * Get formatted messages including conversation history
	 * @param message - The current message (already added to context by the service)
	 * @returns The formatted messages array including conversation history
	 */
	async getFormattedMessage(_message: InternalMessage): Promise<any[]> {
		try {
			// Don't add the message again - it's already been added by the service
			// Just return all formatted messages from the existing conversation history
			return this.getAllFormattedMessages();
		} catch (error) {
			logger.error('Failed to get formatted messages', { error });
			throw new Error(
				`Failed to format message: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Get all formatted messages from conversation history
	 * @returns The formatted messages array
	 */
	async getAllFormattedMessages(): Promise<any[]> {
		try {
			// Get the system prompt
			const prompt = await this.getSystemPrompt();

			// Format all messages in conversation history
			const formattedMessages: any[] = [];

			// For Gemini, we don't add system messages separately
			// The system prompt will be handled by the formatter if needed
			const shouldAddSystemSeparately = this.formatter.constructor.name !== 'GeminiMessageFormatter';

			// Add system prompt as first message - for OpenAI and Anthropic, but not Gemini
			if (prompt && shouldAddSystemSeparately) {
				formattedMessages.push({ role: 'system', content: prompt });
			}

			// Format each message in history
			for (const msg of this.messages) {
				// For Gemini, pass the system prompt to the first user message
				// For other providers, don't pass system prompt to individual message formatting
				const systemPromptForMessage = (!shouldAddSystemSeparately && prompt && msg.role === 'user' && this.messages.indexOf(msg) === 0) ? prompt : null;
				const formatted = this.formatter.format(msg, systemPromptForMessage);
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

	/**
	 * Process a stream response from the LLM
	 * @param response - The stream response from the LLM
	 */

	async processLLMStreamResponse(response: any): Promise<void> {
		if (this.formatter.parseStreamResponse) {
			const msgs = (await this.formatter.parseStreamResponse(response)) ?? [];
			for (const msg of msgs) {
				try {
					await this.addMessage(msg);
				} catch (error) {
					logger.error('Failed to process LLM stream response message', { error });
				}
			}
		} else {
			await this.processLLMResponse(response);
		}
	}

	/**
	 * Process a response from the LLM
	 * @param response - The response from the LLM
	 */

	async processLLMResponse(response: any): Promise<void> {
		const msgs = this.formatter.parseResponse(response) ?? [];
		for (const msg of msgs) {
			try {
				await this.addMessage(msg);
			} catch (error) {
				logger.error('Failed to process LLM response message', { error });
			}
		}
	}

	/**
	 * Get the raw messages array (for inspection, debugging, or deduplication)
	 */
	public getRawMessages(): InternalMessage[] {
		return this.messages;
	}
}
