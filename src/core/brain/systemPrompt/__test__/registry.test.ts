/**
 * Tests for Provider Registry
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultProviderRegistry } from '../registry.js';
import { ProviderConfig, ProviderType, PromptProvider, ProviderContext } from '../interfaces.js';

describe('DefaultProviderRegistry', () => {
	let registry: DefaultProviderRegistry;

	beforeEach(() => {
		registry = new DefaultProviderRegistry();
	});

	describe('constructor', () => {
		it('should register built-in provider types', () => {
			const types = registry.getRegisteredTypes();
			expect(types).toContain(ProviderType.STATIC);
			expect(types).toContain(ProviderType.DYNAMIC);
			expect(types).toContain(ProviderType.FILE_BASED);
		});
	});

	describe('register', () => {
		it('should register a new provider type', () => {
			const mockGenerator = async () => ({}) as PromptProvider;

			registry.register('custom-type', mockGenerator);

			expect(registry.isRegistered('custom-type')).toBe(true);
			expect(registry.getRegisteredTypes()).toContain('custom-type');
		});

		it('should throw error for invalid type', () => {
			const mockGenerator = async () => ({}) as PromptProvider;

			expect(() => registry.register('', mockGenerator)).toThrow(
				'Provider type must be a non-empty string'
			);
			expect(() => registry.register(null as any, mockGenerator)).toThrow(
				'Provider type must be a non-empty string'
			);
		});

		it('should throw error for invalid generator', () => {
			expect(() => registry.register('test', null as any)).toThrow('Generator must be a function');
			expect(() => registry.register('test', 'not a function' as any)).toThrow(
				'Generator must be a function'
			);
		});
	});

	describe('create', () => {
		it('should create static provider', async () => {
			const config: ProviderConfig = {
				name: 'test-static',
				type: ProviderType.STATIC,
				priority: 100,
				enabled: true,
				config: {
					content: 'Static test content',
				},
			};

			const provider = await registry.create(config);

			expect(provider.id).toBe('test-static');
			expect(provider.name).toBe('test-static');
			expect(provider.type).toBe(ProviderType.STATIC);
			expect(provider.priority).toBe(100);
			expect(provider.enabled).toBe(true);
		});

		it('should create dynamic provider', async () => {
			// First register a test generator
			const mockDynamicProvider = {
				registerGenerator: (name: string, generator: any) => {
					// Mock implementation
				},
			};

			const config: ProviderConfig = {
				name: 'test-dynamic',
				type: ProviderType.DYNAMIC,
				priority: 50,
				enabled: true,
				config: {
					generator: 'test-gen',
					generatorConfig: { test: 'value' },
				},
			};

			// This will fail because we haven't registered the generator
			await expect(registry.create(config)).rejects.toThrow();
		});

		it('should throw error for unregistered type', async () => {
			const config: ProviderConfig = {
				name: 'test',
				type: 'unregistered-type' as any,
				priority: 100,
				enabled: true,
			};

			await expect(registry.create(config)).rejects.toThrow(
				"Provider type 'unregistered-type' is not registered"
			);
		});

		it('should handle generator errors', async () => {
			const failingGenerator = async () => {
				throw new Error('Generator failed');
			};

			registry.register('failing-type', failingGenerator);

			const config: ProviderConfig = {
				name: 'test',
				type: 'failing-type' as any,
				priority: 100,
				enabled: true,
			};

			await expect(registry.create(config)).rejects.toThrow("Failed to create provider 'test'");
		});
	});

	describe('isRegistered', () => {
		it('should return true for registered types', () => {
			expect(registry.isRegistered(ProviderType.STATIC)).toBe(true);
			expect(registry.isRegistered(ProviderType.DYNAMIC)).toBe(true);
			expect(registry.isRegistered(ProviderType.FILE_BASED)).toBe(true);
		});

		it('should return false for unregistered types', () => {
			expect(registry.isRegistered('unregistered')).toBe(false);
		});
	});

	describe('getRegisteredTypes', () => {
		it('should return all registered types', () => {
			const types = registry.getRegisteredTypes();

			expect(types).toContain(ProviderType.STATIC);
			expect(types).toContain(ProviderType.DYNAMIC);
			expect(types).toContain(ProviderType.FILE_BASED);
			expect(types.length).toBeGreaterThanOrEqual(3);
		});

		it('should include custom registered types', () => {
			const mockGenerator = async () => ({}) as PromptProvider;
			registry.register('custom', mockGenerator);

			const types = registry.getRegisteredTypes();
			expect(types).toContain('custom');
		});
	});

	describe('unregister', () => {
		it('should unregister a provider type', () => {
			const mockGenerator = async () => ({}) as PromptProvider;
			registry.register('temp-type', mockGenerator);

			expect(registry.isRegistered('temp-type')).toBe(true);

			const result = registry.unregister('temp-type');

			expect(result).toBe(true);
			expect(registry.isRegistered('temp-type')).toBe(false);
		});

		it('should return false for non-existent types', () => {
			const result = registry.unregister('non-existent');
			expect(result).toBe(false);
		});
	});

	describe('clear', () => {
		it('should clear all registered types', () => {
			const mockGenerator = async () => ({}) as PromptProvider;
			registry.register('temp1', mockGenerator);
			registry.register('temp2', mockGenerator);

			expect(registry.getRegisteredTypes().length).toBeGreaterThan(0);

			registry.clear();

			expect(registry.getRegisteredTypes()).toHaveLength(0);
		});
	});
});
