/**
 * Tests for Dynamic Prompt Provider
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DynamicPromptProvider } from '../../providers/dynamic-provider.js';
import { ProviderType, ProviderContext } from '../../interfaces.js';

describe('DynamicPromptProvider', () => {
	let provider: DynamicPromptProvider;
	let mockContext: ProviderContext;

	beforeEach(() => {
		provider = new DynamicPromptProvider('test-dynamic', 'Test Dynamic Provider', 100);
		mockContext = {
			timestamp: new Date('2023-01-01T10:00:00Z'),
			sessionId: 'test-session',
			userId: 'test-user',
		};

		// Register test generators
		DynamicPromptProvider.registerGenerator('test-generator', async (context, config) => {
			return `Current time: ${context.timestamp.toISOString()}`;
		});

		DynamicPromptProvider.registerGenerator('config-generator', async (context, config) => {
			return `Config value: ${config.testValue || 'default'}`;
		});
	});

	afterEach(() => {
		// Clean up registered generators after each test
		const generators = DynamicPromptProvider.getRegisteredGenerators();
		generators.forEach(name => {
			if (name.startsWith('test-')) {
				// Note: We can't actually remove generators in the current implementation
				// This is a limitation we might want to address in the future
			}
		});
	});

	describe('constructor', () => {
		it('should initialize with correct properties', () => {
			expect(provider.id).toBe('test-dynamic');
			expect(provider.name).toBe('Test Dynamic Provider');
			expect(provider.type).toBe(ProviderType.DYNAMIC);
			expect(provider.priority).toBe(100);
			expect(provider.enabled).toBe(true);
		});
	});

	describe('static methods', () => {
		it('should register and list generators', () => {
			const generators = DynamicPromptProvider.getRegisteredGenerators();
			expect(generators).toContain('test-generator');
			expect(generators).toContain('config-generator');
		});

		it('should check if generator is registered', () => {
			expect(DynamicPromptProvider.isGeneratorRegistered('test-generator')).toBe(true);
			expect(DynamicPromptProvider.isGeneratorRegistered('non-existent')).toBe(false);
		});
	});

	describe('validateConfig', () => {
		it('should accept valid config with registered generator', () => {
			const config = { generator: 'test-generator' };
			expect(provider.validateConfig(config)).toBe(true);
		});

		it('should accept config with generator config and template', () => {
			const config = {
				generator: 'test-generator',
				generatorConfig: { testValue: 'hello' },
				template: 'Generated: {{content}}',
			};
			expect(provider.validateConfig(config)).toBe(true);
		});

		it('should reject config without generator', () => {
			const config = { generatorConfig: { test: 'value' } };
			expect(provider.validateConfig(config)).toBe(false);
		});

		it('should reject config with non-string generator', () => {
			const config = { generator: 123 };
			expect(provider.validateConfig(config)).toBe(false);
		});

		it('should reject config with unregistered generator', () => {
			const config = { generator: 'non-existent-generator' };
			expect(provider.validateConfig(config)).toBe(false);
		});

		it('should reject config with invalid generator config', () => {
			const config = {
				generator: 'test-generator',
				generatorConfig: 'not an object',
			};
			expect(provider.validateConfig(config)).toBe(false);
		});

		it('should reject config with non-string template', () => {
			const config = {
				generator: 'test-generator',
				template: 123,
			};
			expect(provider.validateConfig(config)).toBe(false);
		});
	});

	describe('initialize', () => {
		it('should initialize with valid config', async () => {
			const config = { generator: 'test-generator' };
			await expect(provider.initialize(config)).resolves.toBeUndefined();
		});

		it('should throw error with invalid config', async () => {
			const config = { generator: 'non-existent' };
			await expect(provider.initialize(config)).rejects.toThrow('Invalid configuration');
		});
	});

	describe('generateContent', () => {
		it('should generate dynamic content', async () => {
			const config = { generator: 'test-generator' };
			await provider.initialize(config);

			const result = await provider.generateContent(mockContext);
			expect(result).toBe('Current time: 2023-01-01T10:00:00.000Z');
		});

		it('should use generator config', async () => {
			const config = {
				generator: 'config-generator',
				generatorConfig: { testValue: 'custom-value' },
			};
			await provider.initialize(config);

			const result = await provider.generateContent(mockContext);
			expect(result).toBe('Config value: custom-value');
		});

		it('should apply template', async () => {
			const config = {
				generator: 'test-generator',
				template: 'Generated content: {{content}}',
			};
			await provider.initialize(config);

			const result = await provider.generateContent(mockContext);
			expect(result).toBe('Generated content: Current time: 2023-01-01T10:00:00.000Z');
		});

		it('should return empty string when disabled', async () => {
			const config = { generator: 'test-generator' };
			await provider.initialize(config);
			provider.enabled = false;

			const result = await provider.generateContent(mockContext);
			expect(result).toBe('');
		});

		it('should throw error when not initialized', async () => {
			await expect(provider.generateContent(mockContext)).rejects.toThrow('not initialized');
		});

		it('should handle generator errors', async () => {
			DynamicPromptProvider.registerGenerator('error-generator', async () => {
				throw new Error('Generator error');
			});

			const config = { generator: 'error-generator' };
			await provider.initialize(config);

			await expect(provider.generateContent(mockContext)).rejects.toThrow(
				'Failed to generate dynamic content'
			);
		});
	});

	describe('destroy', () => {
		it('should clean up resources', async () => {
			const config = { generator: 'test-generator' };
			await provider.initialize(config);

			await provider.destroy();

			await expect(provider.generateContent(mockContext)).rejects.toThrow('not initialized');
		});
	});
});
