import { describe, it, expect } from 'vitest';
import { GeminiMessageFormatter } from '../gemini.js';
import { InternalMessage } from '../../types.js';

describe('GeminiMessageFormatter', () => {
	let formatter: GeminiMessageFormatter;

	beforeEach(() => {
		formatter = new GeminiMessageFormatter();
	});

	describe('format', () => {
		it('should format a simple user message', () => {
			const message: InternalMessage = {
				role: 'user',
				content: 'Hello, world!',
			};

			const result = formatter.format(message);
			expect(result).toEqual([
				{
					role: 'user',
					parts: [{ text: 'Hello, world!' }],
				},
			]);
		});

		it('should format a system message', () => {
			const message: InternalMessage = {
				role: 'system',
				content: 'You are a helpful assistant.',
			};

			const result = formatter.format(message);
			expect(result).toEqual([
				{
					role: 'user',
					parts: [{ text: 'You are a helpful assistant.' }],
				},
			]);
		});

		it('should format an assistant message with text', () => {
			const message: InternalMessage = {
				role: 'assistant',
				content: 'I can help you with that.',
			};

			const result = formatter.format(message);
			expect(result).toEqual([
				{
					role: 'model',
					parts: [{ text: 'I can help you with that.' }],
				},
			]);
		});

		it('should format an assistant message with tool calls', () => {
			const message: InternalMessage = {
				role: 'assistant',
				content: 'I will help you with that.',
				toolCalls: [
					{
						id: 'call_1',
						type: 'function',
						function: {
							name: 'test_function',
							arguments: '{"param": "value"}',
						},
					},
				],
			};

			const result = formatter.format(message);
			expect(result).toEqual([
				{
					role: 'model',
					parts: [{ text: 'I will help you with that.' }],
				},
				{
					role: 'model',
					parts: [
						{
							functionCall: {
								name: 'test_function',
								args: { param: 'value' },
							},
						},
					],
				},
			]);
		});

		it('should format a tool message', () => {
			const message: InternalMessage = {
				role: 'tool',
				content: '{"result": "success"}',
				toolCallId: 'call_1',
				name: 'test_function',
			};

			const result = formatter.format(message);
			expect(result).toEqual([
				{
					role: 'user',
					parts: [
						{
							functionResponse: {
								name: 'test_function',
								response: {
									result: 'success',
								},
							},
						},
					],
				},
			]);
		});

		it('should format with system prompt', () => {
			const message: InternalMessage = {
				role: 'user',
				content: 'Hello!',
			};

			const result = formatter.format(message, 'You are helpful.');
			expect(result).toEqual([
				{
					role: 'user',
					parts: [{ text: 'You are helpful.' }],
				},
				{
					role: 'user',
					parts: [{ text: 'Hello!' }],
				},
			]);
		});
	});

	describe('parseResponse', () => {
		it('should parse a simple text response', () => {
			const response = {
				candidates: [
					{
						content: {
							parts: [{ text: 'Hello, world!' }],
						},
					},
				],
			};

			const result = formatter.parseResponse(response);
			expect(result).toEqual([
				{
					role: 'assistant',
					content: 'Hello, world!',
				},
			]);
		});

		it('should parse a response with function calls', () => {
			const response = {
				candidates: [
					{
						content: {
							parts: [
								{ text: 'I will help you.' },
								{
									functionCall: {
										name: 'test_function',
										args: { param: 'value' },
									},
								},
							],
						},
					},
				],
			};

			const result = formatter.parseResponse(response);
			expect(result).toEqual([
				{
					role: 'assistant',
					content: 'I will help you.',
					toolCalls: [
						{
							id: expect.stringMatching(/call_\d+_\d+/),
							type: 'function',
							function: {
								name: 'test_function',
								arguments: '{"param":"value"}',
							},
						},
					],
				},
			]);
		});

		it('should handle empty response', () => {
			const response = {};
			const result = formatter.parseResponse(response);
			expect(result).toEqual([]);
		});
	});

	describe('formatUserContent', () => {
		it('should format text content', () => {
			const content = 'Hello, world!';
			const result = formatter['formatUserContent'](content);
			expect(result).toEqual([{ text: 'Hello, world!' }]);
		});

		it('should format image content with URL', () => {
			const content: InternalMessage['content'] = [
				{ type: 'text' as const, text: 'Look at this image:' },
				{ type: 'image' as const, image: 'https://example.com/image.jpg', mimeType: 'image/jpeg' },
			];

			const result = formatter['formatUserContent'](content);
			expect(result).toEqual([
				{ text: 'Look at this image:' },
				{ inlineData: { mimeType: 'image/jpeg', data: { uri: 'https://example.com/image.jpg' } } },
			]);
		});

		it('should format image content with base64 data URI', () => {
			const content: InternalMessage['content'] = [
				{ type: 'image' as const, image: 'data:image/jpeg;base64,abc123', mimeType: 'image/jpeg' },
			];

			const result = formatter['formatUserContent'](content);
			expect(result).toEqual([
				{ inlineData: { mimeType: 'image/jpeg', data: { data: 'abc123' } } },
			]);
		});
	});
});
