import { IMessageFormatter } from './types.js';
import { InternalMessage } from '../types.js';
import { getImageData } from '../utils.js';

export class GeminiMessageFormatter implements IMessageFormatter {
	format(message: Readonly<InternalMessage>, systemPrompt?: string | null): any[] {
		const formattedMessages: any[] = [];
		
		// Handle system prompt if provided
		if (systemPrompt) {
			formattedMessages.push({
				role: 'user',
				parts: [{ text: systemPrompt }]
			});
		}

		// Format the message according to Gemini's expected structure
		const formattedMessage = this.formatMessageForGemini(message);
		if (formattedMessage) {
			formattedMessages.push(formattedMessage);
		}

		return formattedMessages;
	}

	private formatMessageForGemini(message: Readonly<InternalMessage>): any {
		switch (message.role) {
			case 'system':
				// Gemini doesn't have a system role, convert to user message
				return {
					role: 'user',
					parts: [{ text: message.content as string }]
				};

			case 'user':
				return {
					role: 'user',
					parts: this.formatUserContent(message.content)
				};

			case 'assistant':
				const parts = [];
				if (message.content) {
					parts.push({ text: message.content });
				}
				if (message.toolCalls && message.toolCalls.length > 0) {
					for (const toolCall of message.toolCalls) {
						parts.push({
							functionCall: {
								name: toolCall.function.name,
								args: JSON.parse(toolCall.function.arguments)
							}
						});
					}
				}
				return {
					role: 'model',
					parts
				};

			case 'tool':
				// Tool messages are converted to user messages with function results
				return {
					role: 'user',
					parts: [{
						functionResponse: {
							name: message.name!,
							response: {
								name: message.name!,
								content: message.content
							}
						}
					}]
				};

			default:
				throw new Error(`Unsupported message role: ${(message as any).role}`);
		}
	}

	private formatUserContent(content: InternalMessage['content']): any[] {
		if (!Array.isArray(content)) {
			return [{ text: content as string }];
		}

		return content.map(part => {
			if (part.type === 'text') {
				return { text: part.text };
			}
			if (part.type === 'image') {
				const raw = getImageData(part);
				let source: any;
				if (raw.startsWith('http://') || raw.startsWith('https://')) {
					source = { type: 'url', url: raw };
				} else if (raw.startsWith('data:')) {
					// Data URI: split metadata and base64 data
					const [meta, b64] = raw.split(',', 2);
					const mediaTypeMatch = meta?.match(/data:(.*);base64/);
					const mimeType = (mediaTypeMatch && mediaTypeMatch[1]) || part.mimeType || 'application/octet-stream';
					source = { type: 'base64', mimeType, data: b64 };
				} else {
					// Plain base64 string
					source = { type: 'base64', mimeType: part.mimeType, data: raw };
				}
				return { inlineData: source };
			}
			return null;
		}).filter(Boolean);
	}

	parseResponse(response: any): InternalMessage[] {
		const messages: InternalMessage[] = [];
		
		if (!response || !response.candidates || !response.candidates.length) {
			return messages;
		}

		const candidate = response.candidates[0];
		if (!candidate.content || !candidate.content.parts) {
			return messages;
		}

		let textContent = '';
		const toolCalls: any[] = [];

		for (const part of candidate.content.parts) {
			if (part.text) {
				textContent += part.text;
			} else if (part.functionCall) {
				toolCalls.push({
					id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
					type: 'function' as const,
					function: {
						name: part.functionCall.name,
						arguments: JSON.stringify(part.functionCall.args)
					}
				});
			}
		}

		if (textContent || toolCalls.length > 0) {
			messages.push({
				role: 'assistant',
				content: textContent || null,
				...(toolCalls.length > 0 && { toolCalls })
			});
		}

		return messages;
	}

	// Legacy methods for backward compatibility
	formatUserMessage(content: string, toolCalls?: any[]): any {
		const message: any = {
			role: 'user',
			parts: [{ text: content }],
		};
		if (toolCalls && toolCalls.length > 0) {
			message.toolCalls = toolCalls.map(tc => ({
				functionName: tc.function.name,
				args: tc.function.arguments,
				id: tc.id,
			}));
		}
		return message;
	}

	formatAssistantMessage(content: string, toolResponses?: any[]): any {
		const message: any = {
			role: 'assistant',
			parts: [{ text: content }],
		};
		if (toolResponses && toolResponses.length > 0) {
			message.toolResponses = toolResponses.map(tr => ({
				functionName: tr.function.name,
				result: tr.result,
				id: tr.id,
			}));
		}
		return message;
	}
}
