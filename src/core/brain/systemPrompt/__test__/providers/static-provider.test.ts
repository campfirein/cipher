/**
 * Tests for Static Prompt Provider
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StaticPromptProvider } from '../../providers/static-provider.js';
import { ProviderType, ProviderContext } from '../../interfaces.js';

describe('StaticPromptProvider', () => {
	let provider: StaticPromptProvider;
	let mockContext: ProviderContext;

	beforeEach(() => {
		provider = new StaticPromptProvider('test-static', 'Test Static Provider', 100);
		mockContext = {
			timestamp: new Date(),
			sessionId: 'test-session',
			userId: 'test-user',
		};
	});

	describe('constructor', () => {
		it('should initialize with correct properties', () => {
			expect(provider.id).toBe('test-static');
			expect(provider.name).toBe('Test Static Provider');
			expect(provider.type).toBe(ProviderType.STATIC);
			expect(provider.priority).toBe(100);
			expect(provider.enabled).toBe(true);
		});

		it('should allow setting enabled state', () => {
			const disabledProvider = new StaticPromptProvider('test', 'Test', 100, false);
			expect(disabledProvider.enabled).toBe(false);
		});
	});

	describe('validateConfig', () => {
		it('should accept valid config with content only', () => {
			const config = { content: 'Test content' };
			expect(provider.validateConfig(config)).toBe(true);
		});

		it('should accept valid config with content and variables', () => {
			const config = {
				content: 'Hello {{name}}',
				variables: { name: 'World' },
			};
			expect(provider.validateConfig(config)).toBe(true);
		});

		it('should reject config without content', () => {
			const config = { variables: { name: 'test' } };
			expect(provider.validateConfig(config)).toBe(false);
		});

		it('should reject config with non-string content', () => {
			const config = { content: 123 };
			expect(provider.validateConfig(config)).toBe(false);
		});

		it('should reject config with invalid variables', () => {
			const config = {
				content: 'test',
				variables: 'not an object',
			};
			expect(provider.validateConfig(config)).toBe(false);
		});

		it('should reject config with non-string variable values', () => {
			const config = {
				content: 'test',
				variables: { name: 123 },
			};
			expect(provider.validateConfig(config)).toBe(false);
		});
	});

	describe('initialize', () => {
		it('should initialize with valid config', async () => {
			const config = { content: 'Test content' };
			await expect(provider.initialize(config)).resolves.toBeUndefined();
		});

		it('should throw error with invalid config', async () => {
			const config = { content: 123 };
			await expect(provider.initialize(config)).rejects.toThrow('Invalid configuration');
		});
	});

	describe('generateContent', () => {
		it('should return static content', async () => {
			const config = { content: 'Static test content' };
			await provider.initialize(config);

			const result = await provider.generateContent(mockContext);
			expect(result).toBe('Static test content');
		});

		it('should replace template variables', async () => {
			const config = {
				content: 'Hello {{name}}, welcome to {{place}}!',
				variables: { name: 'Alice', place: 'Wonderland' },
			};
			await provider.initialize(config);

			const result = await provider.generateContent(mockContext);
			expect(result).toBe('Hello Alice, welcome to Wonderland!');
		});

		it('should handle multiple occurrences of same variable', async () => {
			const config = {
				content: '{{greeting}} {{name}}! How are you, {{name}}?',
				variables: { greeting: 'Hello', name: 'Bob' },
			};
			await provider.initialize(config);

			const result = await provider.generateContent(mockContext);
			expect(result).toBe('Hello Bob! How are you, Bob?');
		});

		it('should return empty string when disabled', async () => {
			const config = { content: 'Test content' };
			await provider.initialize(config);
			provider.enabled = false;

			const result = await provider.generateContent(mockContext);
			expect(result).toBe('');
		});

		it('should throw error when not initialized', async () => {
			await expect(provider.generateContent(mockContext)).rejects.toThrow('not initialized');
		});
	});

	describe('destroy', () => {
		it('should clean up resources', async () => {
			const config = { content: 'Test content' };
			await provider.initialize(config);

			await provider.destroy();

			await expect(provider.generateContent(mockContext)).rejects.toThrow('not initialized');
		});
	});
});
