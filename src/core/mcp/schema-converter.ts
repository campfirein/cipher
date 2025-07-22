/**
 * JSON Schema to Zod conversion utility for MCP aggregator mode.
 *
 * This file provides utilities to convert JSON Schema definitions (used by MCP tools)
 * into Zod schemas for runtime validation and type safety.
 */

import { z } from 'zod';
import type { ToolParameters } from './types.js';

/**
 * Convert a JSON Schema object to a Zod schema.
 */
export function jsonSchemaToZod(schema: any): z.ZodType<any> {
	if (!schema || typeof schema !== 'object') {
		return z.any();
	}

	const { type, properties, required = [], items, enum: enumValues, anyOf, oneOf, allOf } = schema;

	// Handle union types (anyOf, oneOf)
	if (anyOf && Array.isArray(anyOf)) {
		const unionSchemas = anyOf.map((subSchema: any) => jsonSchemaToZod(subSchema));
		return z.union(unionSchemas as [z.ZodType<any>, z.ZodType<any>, ...z.ZodType<any>[]]);
	}

	if (oneOf && Array.isArray(oneOf)) {
		const unionSchemas = oneOf.map((subSchema: any) => jsonSchemaToZod(subSchema));
		return z.union(unionSchemas as [z.ZodType<any>, z.ZodType<any>, ...z.ZodType<any>[]]);
	}

	// Handle intersection types (allOf)
	if (allOf && Array.isArray(allOf)) {
		return allOf.reduce((acc: z.ZodType<any>, subSchema: any) => {
			const zodSchema = jsonSchemaToZod(subSchema);
			return z.intersection(acc, zodSchema);
		}, z.object({}));
	}

	// Handle enum types
	if (enumValues && Array.isArray(enumValues)) {
		if (enumValues.length === 0) {
			return z.never();
		}
		if (enumValues.length === 1) {
			return z.literal(enumValues[0]);
		}
		return z.enum(enumValues as [string, ...string[]]);
	}

	// Handle primitive types
	switch (type) {
		case 'string': {
			let stringSchema = z.string();
			if (schema.minLength !== undefined) {
				stringSchema = stringSchema.min(schema.minLength);
			}
			if (schema.maxLength !== undefined) {
				stringSchema = stringSchema.max(schema.maxLength);
			}
			if (schema.pattern) {
				stringSchema = stringSchema.regex(new RegExp(schema.pattern));
			}
			if (schema.format === 'email') {
				stringSchema = stringSchema.email();
			}
			if (schema.format === 'url') {
				stringSchema = stringSchema.url();
			}
			if (schema.format === 'uuid') {
				stringSchema = stringSchema.uuid();
			}
			return stringSchema;
		}

		case 'number':
		case 'integer': {
			let numberSchema = type === 'integer' ? z.number().int() : z.number();
			if (schema.minimum !== undefined) {
				numberSchema = numberSchema.min(schema.minimum);
			}
			if (schema.maximum !== undefined) {
				numberSchema = numberSchema.max(schema.maximum);
			}
			if (schema.multipleOf !== undefined) {
				numberSchema = numberSchema.multipleOf(schema.multipleOf);
			}
			return numberSchema;
		}

		case 'boolean':
			return z.boolean();

		case 'null':
			return z.null();

		case 'array': {
			const itemSchema = items ? jsonSchemaToZod(items) : z.any();
			let arraySchema = z.array(itemSchema);
			if (schema.minItems !== undefined) {
				arraySchema = arraySchema.min(schema.minItems);
			}
			if (schema.maxItems !== undefined) {
				arraySchema = arraySchema.max(schema.maxItems);
			}
			return arraySchema;
		}

		case 'object': {
			if (!properties || typeof properties !== 'object') {
				return z.record(z.any());
			}

			const zodProperties: Record<string, z.ZodType<any>> = {};
			const requiredFields = new Set(required);

			for (const [key, propSchema] of Object.entries(properties)) {
				let propZodSchema = jsonSchemaToZod(propSchema);

				// Make optional if not in required array
				if (!requiredFields.has(key)) {
					propZodSchema = propZodSchema.optional();
				}

				zodProperties[key] = propZodSchema;
			}

			let objectSchema = z.object(zodProperties);

			// Handle additional properties
			if (schema.additionalProperties === false) {
				objectSchema = objectSchema.strict() as any;
			} else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
				// Convert to passthrough and let additional validation happen at runtime
				objectSchema = objectSchema.passthrough() as any;
			} else if (schema.additionalProperties !== false) {
				objectSchema = objectSchema.passthrough() as any;
			}

			return objectSchema;
		}

		default:
			// Handle unknown types or missing type
			return z.any();
	}
}

/**
 * Convert MCP tool parameters to Zod schema.
 */
export function toolParametersToZod(parameters: ToolParameters): z.ZodType<any> {
	return jsonSchemaToZod(parameters);
}

/**
 * Create a Zod schema for validating tool arguments.
 */
export function createToolArgumentValidator(parameters: ToolParameters): z.ZodType<any> {
	try {
		return toolParametersToZod(parameters);
	} catch (error) {
		// Fallback to any if conversion fails
		console.warn('Failed to convert tool parameters to Zod schema:', error);
		return z.any();
	}
}

/**
 * Validate tool arguments against a Zod schema.
 */
export function validateToolArguments(
	args: any,
	validator: z.ZodType<any>
): { success: true; data: any } | { success: false; error: string } {
	try {
		const result = validator.parse(args);
		return { success: true, data: result };
	} catch (error) {
		if (error instanceof z.ZodError) {
			const errorMessage = error.errors
				.map(err => `${err.path.join('.')}: ${err.message}`)
				.join('; ');
			return { success: false, error: errorMessage };
		}
		return { success: false, error: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * Create a safe version of a tool parameter schema that doesn't throw on invalid input.
 */
export function createSafeValidator(parameters: ToolParameters): (args: any) => {
	success: boolean;
	data?: any;
	error?: string;
} {
	const validator = createToolArgumentValidator(parameters);

	return (args: any) => {
		const result = validateToolArguments(args, validator);
		if (result.success) {
			return { success: true, data: result.data };
		} else {
			return { success: false, error: (result as { success: false; error: string }).error };
		}
	};
}

/**
 * Convert Zod schema back to JSON Schema (for documentation/introspection).
 */
export function zodToJsonSchema(zodSchema: z.ZodType<any>): any {
	// This is a basic implementation - for production use consider using a library like zod-to-json-schema
	if (zodSchema instanceof z.ZodString) {
		return { type: 'string' };
	}
	if (zodSchema instanceof z.ZodNumber) {
		return { type: 'number' };
	}
	if (zodSchema instanceof z.ZodBoolean) {
		return { type: 'boolean' };
	}
	if (zodSchema instanceof z.ZodArray) {
		return {
			type: 'array',
			items: zodToJsonSchema(zodSchema.element),
		};
	}
	if (zodSchema instanceof z.ZodObject) {
		const properties: Record<string, any> = {};
		const required: string[] = [];

		for (const [key, value] of Object.entries(zodSchema.shape)) {
			properties[key] = zodToJsonSchema(value as z.ZodType<any>);
			// Note: This is simplified - proper detection of required fields would need more sophisticated logic
		}

		return {
			type: 'object',
			properties,
			required: required.length > 0 ? required : undefined,
		};
	}

	// Fallback for unsupported types
	return { type: 'any' };
}
