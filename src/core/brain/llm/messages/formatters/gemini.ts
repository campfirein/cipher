import { logger } from '../../../../logger/index.js';
import { InternalMessage } from '../types.js';
import { getImageData } from '../utils.js';
import { IMessageFormatter } from './types.js';

/**
 * Message formatter for Google Gemini
 *
 * Usage examples:
 *
 * // For single messages without needing an array wrapper:
 * const singleMsg = formatter.formatSingle(message);
 *
 * // For single messages with system prompt (returns array):
 * const withSystem = formatter.formatSingle(message, systemPrompt);
 *
 * // For multiple messages efficiently:
 * const multipleFormatted = formatter.formatMultiple(messages, systemPrompt);
 *
 * // For interface compatibility (always returns array):
 * const compatibleFormat = formatter.format(message, systemPrompt);
 */
export class GeminiMessageFormatter implements IMessageFormatter {
	/**
	 * Format the message into the specific structure of target LLM API.
	 * This method maintains compatibility with the interface but is more efficient for single messages.
	 *
	 * @param message - The message to format.
	 * @param systemPrompt - The system prompt to include (optional).
	 * @returns The formatted message array.
	 */
	format(message: Readonly<InternalMessage>, systemPrompt: string | null = null): any[] {
		const result = this.formatSingle(message, systemPrompt);
		return Array.isArray(result) ? result : [result];
	}

	/**
	 * Format a single message more efficiently without always creating an array.
	 * Use this when you know you're processing a single message and want optimal performance.
	 *
	 * @param message - The message to format.
	 * @param systemPrompt - The system prompt to include (optional).
	 * @returns A single formatted message object or array if system prompt is included.
	 */
	formatSingle(
		message: Readonly<InternalMessage>,
		systemPrompt: string | null = null
	): any | any[] {
		// If we have a system prompt, we need to return an array with system message first
		if (systemPrompt) {
			const systemMessage = {
				role: 'user',
				parts: [{ text: systemPrompt }],
			};
			const formattedMessage = this.formatMessageOnly(message);
			return [systemMessage, formattedMessage];
		}

		// For single message without system prompt, return just the formatted message
		return this.formatMessageOnly(message);
	}

	/**
	 * Format multiple messages efficiently.
	 *
	 * @param messages - Array of messages to format.
	 * @param systemPrompt - The system prompt to include (optional).
	 * @returns Array of formatted messages.
	 */
	formatMultiple(messages: Readonly<InternalMessage[]>, systemPrompt: string | null = null): any[] {
		const formatted = [];

		if (systemPrompt) {
			formatted.push({
				role: 'user',
				parts: [{ text: systemPrompt }],
			});
		}

		for (const message of messages) {
			formatted.push(this.formatMessageOnly(message));
		}

		return formatted;
	}

	/**
	 * Format a single message without any system prompt handling.
	 * This is the core formatting logic extracted for reuse.
	 *
	 * @param message - The message to format.
	 * @returns The formatted message object.
	 */
	private formatMessageOnly(message: Readonly<InternalMessage>): any {
		switch (message.role) {
			case 'system':
				// Gemini doesn't have a system role, convert to user message
				return {
					role: 'user',
					parts: [{ text: message.content as string }],
				};

			case 'user':
				return {
					role: 'user',
					parts: this.formatUserContent(message.content),
				};

			case 'assistant':
				if (message.toolCalls && message.toolCalls.length > 0) {
					const messages = [];
					// Add text content as a separate message if present
					if (message.content) {
						messages.push({
							role: 'model',
							parts: [{ text: message.content as string }],
						});
					}
					// Add each tool call as a separate message
					for (const toolCall of message.toolCalls) {
						messages.push({
							role: 'model',
							parts: [
								{
									functionCall: {
										name: toolCall.function.name,
										args: JSON.parse(toolCall.function.arguments),
									},
								},
							],
						});
					}
					return messages;
				} else {
					return {
						role: 'model',
						parts: [{ text: message.content as string }],
					};
				}

			case 'tool':
				// Tool messages are converted to user messages with function response
				// Gemini expects function responses to be structured differently
				return {
					role: 'user',
					parts: [
						{
							functionResponse: {
								name: message.name!,
								response: {
									name: message.name!,
									content: message.content as string,
								},
							},
						},
					],
				};

			default:
				throw new Error(`Unsupported message role: ${(message as any).role}`);
		}
	}

	parseResponse(response: any): InternalMessage[] {
		const internal: InternalMessage[] = [];
		if (!response || !response.candidates || !Array.isArray(response.candidates)) return internal;

		for (const candidate of response.candidates) {
			if (!candidate.content || !candidate.content.parts) continue;

			let combinedText: string | null = null;
			const calls: InternalMessage['toolCalls'] = [];

			for (const part of candidate.content.parts) {
				if (part.text) {
					combinedText = (combinedText ?? '') + part.text;
				} else if (part.functionCall) {
					calls.push({
						id: `call_${Date.now()}_${Math.random()}`,
						type: 'function',
						function: {
							name: part.functionCall.name,
							arguments: JSON.stringify(part.functionCall.args),
						},
					});
				}
			}

			const assistantMessage: any = {
				role: 'assistant',
				content: combinedText,
			};
			if (calls.length > 0) {
				assistantMessage.toolCalls = calls;
			}
			internal.push(assistantMessage);
		}
		return internal;
	}

	/**
	 * Format the user content into the specific structure of Gemini API.
	 *
	 * @param content - The user content to format.
	 * @returns The formatted user content.
	 */
	private formatUserContent(content: InternalMessage['content']): any[] {
		if (!Array.isArray(content)) {
			return [{ text: content as string }];
		}
		return content
			.map(part => {
				if (part.type === 'text') {
					return { text: part.text };
				}
				if (part.type === 'image') {
					const raw = getImageData(part);
					let inlineData: any;
					if (raw.startsWith('http://') || raw.startsWith('https://')) {
						inlineData = { mimeType: part.mimeType || 'image/jpeg', data: { uri: raw } };
					} else if (raw.startsWith('data:')) {
						// Data URI: split metadata and base64 data
						const [meta, b64] = raw.split(',', 2);
						const mediaTypeMatch = meta?.match(/data:(.*);base64/);
						const mimeType =
							(mediaTypeMatch && mediaTypeMatch[1]) || part.mimeType || 'application/octet-stream';
						inlineData = { mimeType, data: { data: b64 } };
					} else {
						// Plain base64 string
						inlineData = { mimeType: part.mimeType || 'image/jpeg', data: { data: raw } };
					}
					return { inlineData };
				}
				return null;
			})
			.filter(Boolean);
	}
}
