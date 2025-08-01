import { InternalMessage } from '../types.js';
import { getImageData } from '../utils.js';
import { IMessageFormatter } from './types.js';

/**
 * Message formatter for Azure OpenAI
 *
 * Azure OpenAI uses mostly OpenAI-compatible format but has specific field naming differences:
 * - Azure expects: toolCallId (camelCase) in tool response messages
 * - OpenAI expects: tool_call_id (snake_case) in tool response messages
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
export class AzureMessageFormatter implements IMessageFormatter {
	/**
	 * Format the message into the specific structure of Azure OpenAI API.
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
				role: 'system',
				content: systemPrompt,
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
				role: 'system',
				content: systemPrompt,
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
	 * Handles Azure OpenAI specific field naming requirements.
	 *
	 * @param message - The message to format.
	 * @returns The formatted message object.
	 */
	private formatMessageOnly(message: Readonly<InternalMessage>): any {
		switch (message.role) {
			case 'system':
				return {
					role: 'system',
					content: message.content,
				};

			case 'user':
				return {
					role: 'user',
					content: this.formatUserContent(message.content),
				};

			case 'assistant':
				if (message.toolCalls && message.toolCalls.length > 0) {
					return {
						role: 'assistant',
						content: message.content,
						tool_calls: message.toolCalls,
					};
				} else {
					return {
						role: 'assistant',
						content: message.content,
					};
				}

			case 'tool':
				// Azure OpenAI expects toolCallId (camelCase) instead of tool_call_id (snake_case)
				return {
					role: 'tool',
					content: message.content,
					toolCallId: message.toolCallId, // Use camelCase for Azure
					name: message.name,
				};

			default:
				throw new Error(`Unsupported message role: ${(message as any).role}`);
		}
	}

	parseResponse(response: any): InternalMessage[] {
		const internal: InternalMessage[] = [];
		if (!response.choices || !Array.isArray(response.choices)) return internal;

		for (const choice of response.choices) {
			const msg = (choice as any).message;
			if (!msg || !msg.role) continue;

			const role = msg.role as InternalMessage['role'];
			if (role === 'assistant') {
				const content = msg.content ?? null;

				// Handle multiple Azure OpenAI tool call formats
				const toolCalls =
					msg.tool_calls ||
					msg.toolCalls ||
					(msg.functionCall
						? [
								{
									id: `call_${Date.now()}`,
									type: 'function',
									function: {
										name: msg.functionCall.name,
										arguments: msg.functionCall.arguments,
									},
								},
							]
						: null);

				if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
					const calls = toolCalls.map((call: any) => ({
						id: call.id,
						type: 'function' as const,
						function: {
							name: call.function.name,
							arguments: call.function.arguments,
						},
					}));
					internal.push({ role: 'assistant', content, toolCalls: calls });
				} else {
					internal.push({ role: 'assistant', content });
				}
			} else if (role === 'tool') {
				internal.push({
					role: 'tool',
					content: msg.content!,
					// Handle both Azure (toolCallId) and OpenAI (tool_call_id) formats
					toolCallId: msg.toolCallId || msg.tool_call_id!,
					name: msg.name!,
				});
			} else if (role === 'user' || role === 'system') {
				if (msg.content) {
					internal.push({ role, content: msg.content });
				}
			}
		}
		return internal;
	}

	/**
	 * Format the user content into the specific structure of Azure OpenAI API.
	 *
	 * @param content - The user content to format.
	 * @returns The formatted user content.
	 */
	private formatUserContent(content: InternalMessage['content']): any {
		if (!Array.isArray(content)) {
			return content;
		}
		return content
			.map(part => {
				if (part.type === 'text') {
					return { type: 'text', text: part.text };
				}
				if (part.type === 'image') {
					const raw = getImageData(part);
					const url =
						raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')
							? raw
							: `data:${part.mimeType || 'application/octet-stream'};base64,${raw}`;
					return { type: 'image_url', image_url: { url } };
				}
				return null;
			})
			.filter(Boolean);
	}
}
