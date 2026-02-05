import type {ZodSchema} from 'zod'

import {zodToJsonSchema} from 'zod-to-json-schema'

import type {JSONSchema7} from '../../../core/domain/tools/types.js'

/**
 * Convert a Zod schema to JSON Schema v7.
 * Used to expose tool schemas to the LLM.
 *
 * @param zodSchema - Zod schema to convert
 * @returns JSON Schema v7 representation
 */
export function convertZodToJsonSchema(zodSchema: ZodSchema): JSONSchema7 {
  try {
    // Convert using zod-to-json-schema library
    const jsonSchema = zodToJsonSchema(zodSchema, {
      // Remove $schema field as it's not needed for tool definitions
      $refStrategy: 'none',
    })

    // Cast to JSONSchema7 (zod-to-json-schema returns compatible format)
    return jsonSchema as JSONSchema7
  } catch {
    // Fallback to basic object schema if conversion fails

    return {
      additionalProperties: false,
      properties: {},
      type: 'object',
    }
  }
}
