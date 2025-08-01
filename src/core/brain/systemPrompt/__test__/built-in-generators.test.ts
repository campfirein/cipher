/**
 * Tests for Built-in Dynamic Content Generators
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	timestampGenerator,
	sessionContextGenerator,
	memoryContextGenerator,
	environmentGenerator,
	conditionalGenerator,
	registerBuiltInGenerators,
	getBuiltInGeneratorNames,
} from '../built-in-generators.js';
import { ProviderContext } from '../interfaces.js';

describe('Built-in Dynamic Content Generators', () => {
	let mockContext: ProviderContext;

	beforeEach(() => {
		mockContext = {
			timestamp: new Date('2023-06-15T10:30:00Z'),
			sessionId: 'session-123',
			userId: 'user-456',
			memoryContext: {
				previousTopics: ['JavaScript', 'TypeScript'],
				userPreferences: { theme: 'dark', language: 'en' },
			},
			metadata: {
				clientVersion: '1.0.0',
			},
		};
	});

	describe('timestampGenerator', () => {
		it('should generate ISO timestamp by default', async () => {
			const result = await timestampGenerator(mockContext, {});
			expect(result).toBe('2023-06-15T10:30:00.000Z');
		});

		it('should generate locale formatted timestamp', async () => {
			const config = { format: 'locale' };
			const result = await timestampGenerator(mockContext, config);
			expect(result).toMatch(/June 15, 2023/);
		});

		it('should generate date-only format', async () => {
			const config = { format: 'date-only' };
			const result = await timestampGenerator(mockContext, config);
			expect(result).toBe('2023-06-15');
		});

		it('should generate time-only format', async () => {
			const config = { format: 'time-only' };
			const result = await timestampGenerator(mockContext, config);
			expect(result).toBe('10:30:00');
		});

		it('should include timezone when requested', async () => {
			const config = { format: 'locale', includeTimezone: true };
			const result = await timestampGenerator(mockContext, config);
			expect(result.includes('GMT') || result.includes('UTC')).toBe(true);
		});
	});

	describe('sessionContextGenerator', () => {
		it('should generate context info in list format by default', async () => {
			const result = await sessionContextGenerator(mockContext, {});

			expect(result).toContain('Session ID: session-123');
			expect(result).toContain('User ID: user-456');
			expect(result).toContain('\n');
		});

		it('should generate inline format', async () => {
			const config = { format: 'inline' };
			const result = await sessionContextGenerator(mockContext, config);

			expect(result).toContain('Session ID: session-123');
			expect(result).toContain('User ID: user-456');
			expect(result).toContain(', ');
		});

		it('should generate JSON format', async () => {
			const config = { format: 'json' };
			const result = await sessionContextGenerator(mockContext, config);

			const parsed = JSON.parse(result);
			expect(parsed.sessionId).toBe('session-123');
			expect(parsed.userId).toBe('user-456');
		});

		it('should include only specified fields', async () => {
			const config = { includeFields: ['sessionId'] };
			const result = await sessionContextGenerator(mockContext, config);

			expect(result).toContain('Session ID: session-123');
			expect(result).not.toContain('User ID');
		});

		it('should include timestamp when requested', async () => {
			const config = { includeFields: ['sessionId', 'timestamp'] };
			const result = await sessionContextGenerator(mockContext, config);

			expect(result).toContain('Session ID: session-123');
			expect(result).toContain('Timestamp: 2023-06-15T10:30:00.000Z');
		});

		it('should return empty string when no fields match', async () => {
			const contextWithoutIds: ProviderContext = {
				timestamp: new Date(),
				metadata: {},
			};

			const result = await sessionContextGenerator(contextWithoutIds, {});
			expect(result).toBe('');
		});
	});

	describe('memoryContextGenerator', () => {
		it('should generate summary format by default', async () => {
			const result = await memoryContextGenerator(mockContext, {});
			expect(result).toBe('Memory context contains 2 items');
		});

		it('should generate list format', async () => {
			const config = { format: 'list' };
			const result = await memoryContextGenerator(mockContext, config);

			expect(result).toContain('previousTopics:');
			expect(result).toContain('userPreferences:');
		});

		it('should generate JSON format', async () => {
			const config = { format: 'json' };
			const result = await memoryContextGenerator(mockContext, config);

			const parsed = JSON.parse(result);
			expect(parsed.previousTopics).toEqual(['JavaScript', 'TypeScript']);
			expect(parsed.userPreferences.theme).toBe('dark');
		});

		it('should limit items in list format', async () => {
			const config = { format: 'list', maxItems: 1 };
			const result = await memoryContextGenerator(mockContext, config);

			const lines = result.split('\n');
			expect(lines).toHaveLength(1);
		});

		it('should handle empty memory context', async () => {
			const contextWithoutMemory: ProviderContext = {
				timestamp: new Date(),
				sessionId: 'test',
			};

			const result = await memoryContextGenerator(contextWithoutMemory, {});
			expect(result).toBe('No memory context available');
		});

		it('should use custom empty message', async () => {
			const contextWithoutMemory: ProviderContext = {
				timestamp: new Date(),
				sessionId: 'test',
			};

			const config = { emptyMessage: 'Custom empty message' };
			const result = await memoryContextGenerator(contextWithoutMemory, config);
			expect(result).toBe('Custom empty message');
		});
	});

	describe('environmentGenerator', () => {
		it('should use production environment by default', async () => {
			const result = await environmentGenerator(mockContext, {});
			expect(result).toBe('Production environment: Exercise caution with all operations.');
		});

		it('should use specified environment', async () => {
			const config = { environment: 'development' };
			const result = await environmentGenerator(mockContext, config);
			expect(result).toBe(
				'Development mode: Enhanced logging and debugging features are available.'
			);
		});

		it('should use custom messages', async () => {
			const config = {
				environment: 'custom',
				messages: {
					custom: 'Custom environment message',
				},
			};
			const result = await environmentGenerator(mockContext, config);
			expect(result).toBe('Custom environment message');
		});

		it('should fallback to default format for unknown environment', async () => {
			const config = { environment: 'unknown' };
			const result = await environmentGenerator(mockContext, config);
			expect(result).toBe('Environment: unknown');
		});
	});

	describe('conditionalGenerator', () => {
		it('should evaluate string conditions', async () => {
			const config = {
				conditions: [
					{
						if: 'userId',
						then: 'User is logged in',
					},
				],
				else: 'Anonymous user',
			};

			const result = await conditionalGenerator(mockContext, config);
			expect(result).toBe('User is logged in');
		});

		it('should evaluate object conditions', async () => {
			const config = {
				conditions: [
					{
						if: { field: 'sessionId', operator: 'exists' },
						then: 'Session is active',
					},
				],
				else: 'No active session',
			};

			const result = await conditionalGenerator(mockContext, config);
			expect(result).toBe('Session is active');
		});

		it('should evaluate equals operator', async () => {
			const config = {
				conditions: [
					{
						if: { field: 'userId', operator: 'equals', value: 'user-456' },
						then: 'Correct user',
					},
				],
				else: 'Wrong user',
			};

			const result = await conditionalGenerator(mockContext, config);
			expect(result).toBe('Correct user');
		});

		it('should return else clause when no conditions match', async () => {
			const contextWithoutIds: ProviderContext = {
				timestamp: new Date(),
				metadata: {},
			};

			const config = {
				conditions: [
					{
						if: 'userId',
						then: 'User found',
					},
				],
				else: 'No user',
			};

			const result = await conditionalGenerator(contextWithoutIds, config);
			expect(result).toBe('No user');
		});

		it('should return empty string when no else clause and no matches', async () => {
			const contextWithoutIds: ProviderContext = {
				timestamp: new Date(),
				metadata: {},
			};

			const config = {
				conditions: [
					{
						if: 'userId',
						then: 'User found',
					},
				],
			};

			const result = await conditionalGenerator(contextWithoutIds, config);
			expect(result).toBe('');
		});

		it('should evaluate multiple conditions in order', async () => {
			const config = {
				conditions: [
					{
						if: 'nonExistentField',
						then: 'Should not match',
					},
					{
						if: 'sessionId',
						then: 'Session found',
					},
					{
						if: 'userId',
						then: 'User found',
					},
				],
			};

			const result = await conditionalGenerator(mockContext, config);
			expect(result).toBe('Session found');
		});
	});

	describe('utility functions', () => {
		it('should return all built-in generator names', () => {
			const names = getBuiltInGeneratorNames();

			expect(names).toContain('timestamp');
			expect(names).toContain('session-context');
			expect(names).toContain('memory-context');
			expect(names).toContain('environment');
			expect(names).toContain('conditional');
			expect(names).toHaveLength(5);
		});

		it('should register built-in generators', async () => {
			// This test mainly ensures the function exists and can be called
			await expect(registerBuiltInGenerators()).resolves.toBeUndefined();
		});
	});
});
