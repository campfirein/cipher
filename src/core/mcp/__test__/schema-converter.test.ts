/**
 * Tests for JSON Schema to Zod conversion utility
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
	jsonSchemaToZod,
	toolParametersToZod,
	createToolArgumentValidator,
	validateToolArguments,
	createSafeValidator,
} from '../schema-converter.js';
import type { ToolParameters } from '../types.js';

describe('Schema Converter', () => {
	describe('jsonSchemaToZod', () => {
		it('should convert primitive types correctly', () => {
			// String
			const stringSchema = jsonSchemaToZod({ type: 'string' });
			expect(stringSchema.parse('test')).toBe('test');
			expect(() => stringSchema.parse(123)).toThrow();

			// Number
			const numberSchema = jsonSchemaToZod({ type: 'number' });
			expect(numberSchema.parse(123)).toBe(123);
			expect(numberSchema.parse(123.45)).toBe(123.45);
			expect(() => numberSchema.parse('123')).toThrow();

			// Integer
			const integerSchema = jsonSchemaToZod({ type: 'integer' });
			expect(integerSchema.parse(123)).toBe(123);
			expect(() => integerSchema.parse(123.45)).toThrow();

			// Boolean
			const booleanSchema = jsonSchemaToZod({ type: 'boolean' });
			expect(booleanSchema.parse(true)).toBe(true);
			expect(booleanSchema.parse(false)).toBe(false);
			expect(() => booleanSchema.parse('true')).toThrow();

			// Null
			const nullSchema = jsonSchemaToZod({ type: 'null' });
			expect(nullSchema.parse(null)).toBe(null);
			expect(() => nullSchema.parse(undefined)).toThrow();
		});

		it('should handle string constraints', () => {
			const schema = jsonSchemaToZod({
				type: 'string',
				minLength: 2,
				maxLength: 10,
				pattern: '^[a-z]+$',
			});

			expect(schema.parse('abc')).toBe('abc');
			expect(() => schema.parse('a')).toThrow(); // Too short
			expect(() => schema.parse('abcdefghijk')).toThrow(); // Too long
			expect(() => schema.parse('ABC')).toThrow(); // Pattern mismatch
		});

		it('should handle string formats', () => {
			const emailSchema = jsonSchemaToZod({ type: 'string', format: 'email' });
			expect(emailSchema.parse('test@example.com')).toBe('test@example.com');
			expect(() => emailSchema.parse('invalid-email')).toThrow();

			const urlSchema = jsonSchemaToZod({ type: 'string', format: 'url' });
			expect(urlSchema.parse('https://example.com')).toBe('https://example.com');
			expect(() => urlSchema.parse('not-a-url')).toThrow();

			const uuidSchema = jsonSchemaToZod({ type: 'string', format: 'uuid' });
			expect(uuidSchema.parse('123e4567-e89b-12d3-a456-426614174000')).toBe(
				'123e4567-e89b-12d3-a456-426614174000'
			);
			expect(() => uuidSchema.parse('not-a-uuid')).toThrow();
		});

		it('should handle number constraints', () => {
			const schema = jsonSchemaToZod({
				type: 'number',
				minimum: 0,
				maximum: 100,
				multipleOf: 5,
			});

			expect(schema.parse(25)).toBe(25);
			expect(() => schema.parse(-1)).toThrow(); // Below minimum
			expect(() => schema.parse(101)).toThrow(); // Above maximum
			expect(() => schema.parse(7)).toThrow(); // Not multiple of 5
		});

		it('should handle array types', () => {
			const stringArraySchema = jsonSchemaToZod({
				type: 'array',
				items: { type: 'string' },
				minItems: 1,
				maxItems: 3,
			});

			expect(stringArraySchema.parse(['a', 'b'])).toEqual(['a', 'b']);
			expect(() => stringArraySchema.parse([])).toThrow(); // Too few items
			expect(() => stringArraySchema.parse(['a', 'b', 'c', 'd'])).toThrow(); // Too many items
			expect(() => stringArraySchema.parse(['a', 123])).toThrow(); // Wrong item type
		});

		it('should handle object types', () => {
			const objectSchema = jsonSchemaToZod({
				type: 'object',
				properties: {
					name: { type: 'string' },
					age: { type: 'number' },
					email: { type: 'string', format: 'email' },
				},
				required: ['name', 'age'],
			});

			expect(
				objectSchema.parse({
					name: 'John',
					age: 30,
					email: 'john@example.com',
				})
			).toEqual({
				name: 'John',
				age: 30,
				email: 'john@example.com',
			});

			expect(objectSchema.parse({ name: 'Jane', age: 25 })).toEqual({
				name: 'Jane',
				age: 25,
			});

			expect(() => objectSchema.parse({ name: 'John' })).toThrow(); // Missing required age
			expect(() => objectSchema.parse({ age: 30 })).toThrow(); // Missing required name
		});

		it('should handle enum types', () => {
			const enumSchema = jsonSchemaToZod({
				enum: ['red', 'green', 'blue'],
			});

			expect(enumSchema.parse('red')).toBe('red');
			expect(enumSchema.parse('green')).toBe('green');
			expect(() => enumSchema.parse('yellow')).toThrow();
		});

		it('should handle union types (anyOf)', () => {
			const unionSchema = jsonSchemaToZod({
				anyOf: [{ type: 'string' }, { type: 'number' }],
			});

			expect(unionSchema.parse('test')).toBe('test');
			expect(unionSchema.parse(123)).toBe(123);
			expect(() => unionSchema.parse(true)).toThrow();
		});

		it('should handle oneOf types', () => {
			const oneOfSchema = jsonSchemaToZod({
				oneOf: [{ type: 'string', pattern: '^[0-9]+$' }, { type: 'number' }],
			});

			expect(oneOfSchema.parse('123')).toBe('123');
			expect(oneOfSchema.parse(456)).toBe(456);
			expect(() => oneOfSchema.parse('abc')).toThrow();
		});

		it('should handle allOf types (intersection)', () => {
			const allOfSchema = jsonSchemaToZod({
				allOf: [
					{
						type: 'object',
						properties: { name: { type: 'string' } },
						required: ['name'],
					},
					{
						type: 'object',
						properties: { age: { type: 'number' } },
						required: ['age'],
					},
				],
			});

			expect(allOfSchema.parse({ name: 'John', age: 30 })).toEqual({
				name: 'John',
				age: 30,
			});

			expect(() => allOfSchema.parse({ name: 'John' })).toThrow(); // Missing age
		});

		it('should handle unknown or missing types', () => {
			const anySchema = jsonSchemaToZod({});
			expect(anySchema.parse('anything')).toBe('anything');
			expect(anySchema.parse(123)).toBe(123);
			expect(anySchema.parse(true)).toBe(true);

			const unknownTypeSchema = jsonSchemaToZod({ type: 'unknown' as any });
			expect(unknownTypeSchema.parse('anything')).toBe('anything');
		});
	});

	describe('toolParametersToZod', () => {
		it('should convert tool parameters correctly', () => {
			const toolParams: ToolParameters = {
				type: 'object',
				properties: {
					message: {
						type: 'string',
						description: 'The message to send',
					},
					count: {
						type: 'number',
						description: 'How many times to repeat',
					},
				},
				required: ['message'],
			};

			const zodSchema = toolParametersToZod(toolParams);

			expect(zodSchema.parse({ message: 'hello', count: 3 })).toEqual({
				message: 'hello',
				count: 3,
			});

			expect(zodSchema.parse({ message: 'hello' })).toEqual({
				message: 'hello',
			});

			expect(() => zodSchema.parse({ count: 3 })).toThrow(); // Missing required message
		});
	});

	describe('createToolArgumentValidator', () => {
		it('should create a working validator', () => {
			const toolParams: ToolParameters = {
				type: 'object',
				properties: {
					text: { type: 'string' },
					number: { type: 'number' },
				},
				required: ['text'],
			};

			const validator = createToolArgumentValidator(toolParams);

			expect(validator.parse({ text: 'hello', number: 42 })).toEqual({
				text: 'hello',
				number: 42,
			});

			expect(() => validator.parse({ number: 42 })).toThrow(); // Missing text
		});

		it('should fallback to any schema on conversion error', () => {
			// Mock console.warn to suppress warning
			const originalWarn = console.warn;
			console.warn = () => {};

			const invalidParams = null as any;
			const validator = createToolArgumentValidator(invalidParams);

			// Should accept anything due to fallback
			expect(validator.parse('anything')).toBe('anything');

			console.warn = originalWarn;
		});
	});

	describe('validateToolArguments', () => {
		it('should validate successfully with correct data', () => {
			const validator = z.object({
				name: z.string(),
				age: z.number(),
			});

			const result = validateToolArguments({ name: 'John', age: 30 }, validator);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual({ name: 'John', age: 30 });
			}
		});

		it('should return error with invalid data', () => {
			const validator = z.object({
				name: z.string(),
				age: z.number(),
			});

			const result = validateToolArguments({ name: 'John', age: 'thirty' }, validator);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('age');
			}
		});

		it('should handle non-Zod errors', () => {
			const throwingValidator = {
				parse: () => {
					throw new Error('Custom error');
				},
			} as any;

			const result = validateToolArguments({}, throwingValidator);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('Custom error');
			}
		});
	});

	describe('createSafeValidator', () => {
		it('should create a safe validator that returns success/error objects', () => {
			const toolParams: ToolParameters = {
				type: 'object',
				properties: {
					value: { type: 'string' },
				},
				required: ['value'],
			};

			const safeValidator = createSafeValidator(toolParams);

			const successResult = safeValidator({ value: 'test' });
			expect(successResult.success).toBe(true);
			expect(successResult.data).toEqual({ value: 'test' });

			const errorResult = safeValidator({ value: 123 });
			expect(errorResult.success).toBe(false);
			expect(errorResult.error).toContain('value');
		});
	});
});
