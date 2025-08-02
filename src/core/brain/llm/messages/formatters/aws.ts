import { IMessageFormatter } from './types.js';
import { InternalMessage } from '../types.js';

// Anthropic (Claude) formatter
export class BedrockAnthropicMessageFormatter implements IMessageFormatter {
	format(
		message: Readonly<InternalMessage>,
		_systemPrompt: string | null = null,
		_tools?: any[]
	): any[] {
		const role = message.role;
		let contentArr: any[] = [];

		// Handle different message roles and content types
		if (role === 'user' || role === 'assistant') {
			if (typeof message.content === 'string') {
				// String content - convert to text block
				if (message.content.trim()) {
					contentArr.push({ type: 'text', text: message.content });
				}
			} else if (Array.isArray(message.content)) {
				// Array content - process each item
				for (const c of message.content) {
					if (typeof c === 'string') {
						const textContent = c as string;
						if (textContent.trim()) {
							contentArr.push({ type: 'text', text: textContent });
						}
					} else if (c && typeof c === 'object' && 'type' in c) {
						if (c.type === 'image' && 'image' in c) {
							contentArr.push({ type: 'image', image: c.image, mimeType: c.mimeType });
						} else if (c.type === 'text' && 'text' in c && typeof c.text === 'string') {
							if (c.text.trim()) {
								contentArr.push({ type: 'text', text: c.text });
							}
						}
					}
				}
			}
		} else if (role === 'tool') {
			// Tool messages should be converted to user messages with tool_result content
			// This is handled in the AWS service, not here
			return [];
		} else if (role === 'system') {
			// System messages are handled separately in the AWS service
			return [];
		}

		// AWS Bedrock requires non-empty text content blocks
		// If we have no content, skip this message entirely
		if (contentArr.length === 0) {
			return [];
		}

		return [{ role, content: contentArr }];
	}
	parseResponse(response: any): InternalMessage[] {
		const internal: InternalMessage[] = [];
		if (!response || !response.content) return internal;
		for (const block of response.content) {
			if (block.type === 'text') {
				internal.push({ role: 'assistant', content: block.text });
			} else if (block.type === 'tool_use') {
				internal.push({
					role: 'assistant',
					content: '',
					toolCalls: [
						{
							id: block.id,
							type: 'function',
							function: {
								name: block.name,
								arguments: JSON.stringify(block.input),
							},
						},
					],
				});
			}
		}
		return internal;
	}
	formatTools(_tools: any): any[] {
		if (!_tools || typeof _tools !== 'object') return [];
		return Object.entries(_tools).map(([toolName, tool]: [string, any]) => ({
			name: toolName,
			description: tool.description,
			input_schema: tool.parameters,
		}));
	}
}

// Llama formatter
export class BedrockLlamaMessageFormatter implements IMessageFormatter {
	format(message: Readonly<InternalMessage>, _systemPrompt: string | null = null): any[] {
		let prompt = '<|begin_of_text|>';
		if (_systemPrompt) {
			prompt += `<|start_header_id|>system<|end_header_id|> ${_systemPrompt} <|eot_id|>`;
		}
		const role = message.role === 'assistant' ? 'assistant' : 'user';
		const content = Array.isArray(message.content)
			? message.content
					.filter((c: any) => c.type === 'text')
					.map((c: any) => c.text)
					.join('')
			: message.content;
		prompt += `<|start_header_id|>${role}<|end_header_id|> ${content} <|eot_id|>`;
		prompt += '<|start_header_id|>assistant<|end_header_id|>';
		return [
			{
				prompt,
				max_gen_len: 512,
				temperature: 0.5,
				top_p: 0.9,
			},
		];
	}
	parseResponse(response: any): InternalMessage[] {
		return [{ role: 'assistant', content: response.generation }];
	}
	formatTools(_tools: any): any[] {
		return [];
	}
}

// Titan formatter
export class BedrockTitanMessageFormatter implements IMessageFormatter {
	format(message: Readonly<InternalMessage>, systemPrompt: string | null = null): any[] {
		let inputText = '';
		if (systemPrompt) {
			inputText += `${systemPrompt}\n\n`;
		}
		const role = message.role === 'assistant' ? 'Bot' : 'User';
		const content = Array.isArray(message.content)
			? message.content
					.filter((c: any) => c.type === 'text')
					.map((c: any) => c.text)
					.join('')
			: message.content;
		inputText += `${role}: ${content}\n`;
		inputText += 'Bot:';
		return [
			{
				inputText,
				textGenerationConfig: {
					maxTokenCount: 512,
					temperature: 0.7,
					topP: 0.9,
					stopSequences: [],
				},
			},
		];
	}
	parseResponse(response: any): InternalMessage[] {
		const textContent = response.results.map((result: any) => result.outputText).join('');
		return [{ role: 'assistant', content: textContent }];
	}
	formatTools(_tools: any): any[] {
		return [];
	}
}

// DeepSeek formatter
export class BedrockDeepSeekMessageFormatter implements IMessageFormatter {
	format(message: Readonly<InternalMessage>, systemPrompt: string | null = null): any[] {
		let prompt = '<｜begin of sentence｜>';
		let firstUserMessage = true;
		const content = Array.isArray(message.content)
			? message.content
					.filter((c: any) => c.type === 'text')
					.map((c: any) => c.text)
					.join('')
			: message.content;
		if (message.role === 'user') {
			let userContent = content;
			if (firstUserMessage && systemPrompt) {
				userContent = `${systemPrompt}\n\n${content}`;
				firstUserMessage = false;
			}
			prompt += ' ' + userContent;
		} else if (message.role === 'assistant') {
			prompt += ' ' + content;
		}
		prompt += ' <think>\n';
		return [
			{
				prompt,
				temperature: 0.5,
				top_p: 0.9,
				max_tokens: 512,
			},
		];
	}
	parseResponse(response: any): InternalMessage[] {
		const textContent = response.choices.map((choice: any) => choice.text).join('');
		return [{ role: 'assistant', content: textContent }];
	}
	formatTools(_tools: any): any[] {
		return [];
	}
}

// AI21 formatter
export class BedrockAI21MessageFormatter implements IMessageFormatter {
	format(message: Readonly<InternalMessage>, systemPrompt: string | null = null): any[] {
		const ai21Messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
		if (systemPrompt) {
			ai21Messages.push({ role: 'system', content: systemPrompt });
		}
		const content = Array.isArray(message.content)
			? message.content
					.filter((c: any) => c.type === 'text')
					.map((c: any) => c.text)
					.join('')
			: message.content;
		ai21Messages.push({
			role: message.role as 'user' | 'assistant' | 'system',
			content: content || '',
		});
		return [
			{
				messages: ai21Messages,
				temperature: 1.0,
				top_p: 1.0,
				max_tokens: 4096,
				frequency_penalty: 0,
				presence_penalty: 0,
			},
		];
	}
	parseResponse(response: any): InternalMessage[] {
		const textContent = response.choices.map((choice: any) => choice.message.content).join('');
		return [{ role: 'assistant', content: textContent }];
	}
	formatTools(_tools: any): any[] {
		return [];
	}
}
