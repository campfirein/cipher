/**
 * LLM Configuration Schemas
 *
 * Zod schemas for validating LLM configuration with cross-field validation.
 */

import {z} from 'zod'

import {ErrorScope, ErrorType, LLMErrorCode} from './error-codes.js'
import {acceptsAnyModel, getMaxInputTokensForModel, getSupportedModels, isValidProviderModel} from './registry.js'
import {LLM_PROVIDERS} from './types.js'

/**
 * Default-free field definitions for LLM configuration.
 * Used to build both the full config schema (with defaults) and the updates schema (no defaults).
 */
const LLMConfigFields = {
  maxInputTokens: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('Max input tokens for history; defaults to model limit'),

  maxIterations: z.coerce
    .number()
    .int()
    .positive()
    .describe('Max iterations for agentic loops'),

  maxOutputTokens: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('Max tokens for model output'),

  model: z
    .string()
    .min(1, 'Model name is required')
    .describe('Specific model name for the selected provider'),

  provider: z
    .enum(LLM_PROVIDERS)
    .describe("LLM provider (e.g., 'claude', 'gemini', 'openrouter')"),

  temperature: z.coerce
    .number()
    .min(0)
    .max(2)
    .optional()
    .describe('Randomness: 0 deterministic, 2 creative'),

  timeout: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('Request timeout in milliseconds'),
} as const

/**
 * Base LLM config object schema (before validation/branding).
 */
export const LLMConfigBaseSchema = z
  .object({
    maxInputTokens: LLMConfigFields.maxInputTokens,
    maxIterations: z.coerce.number().int().positive().default(50),
    maxOutputTokens: LLMConfigFields.maxOutputTokens,
    model: LLMConfigFields.model,
    provider: LLMConfigFields.provider,
    temperature: LLMConfigFields.temperature,
    timeout: LLMConfigFields.timeout,
  })
  .strict()

/**
 * Full LLM config schema with cross-field validation.
 */
export const LLMConfigSchema = LLMConfigBaseSchema.superRefine((data, ctx) => {
  const maxInputTokensIsSet = data.maxInputTokens !== null && data.maxInputTokens !== undefined

  // Validate model exists for provider (unless provider accepts any model)
  if (!acceptsAnyModel(data.provider) && !isValidProviderModel(data.provider, data.model)) {
    const supportedModelsList = getSupportedModels(data.provider)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        `Model '${data.model}' is not supported for provider '${data.provider}'. ` +
        `Supported: ${supportedModelsList.slice(0, 5).join(', ')}${supportedModelsList.length > 5 ? '...' : ''}`,
      params: {
        code: LLMErrorCode.MODEL_INCOMPATIBLE,
        scope: ErrorScope.LLM,
        type: ErrorType.USER,
      },
      path: ['model'],
    })
  }

  // Validate maxInputTokens doesn't exceed model limit
  if (maxInputTokensIsSet && !acceptsAnyModel(data.provider)) {
    try {
      const modelMax = getMaxInputTokensForModel(data.provider, data.model)
      if (data.maxInputTokens! > modelMax) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `maxInputTokens (${data.maxInputTokens}) exceeds model limit (${modelMax}) ` +
            `for '${data.model}'`,
          params: {
            code: LLMErrorCode.TOKENS_EXCEEDED,
            scope: ErrorScope.LLM,
            type: ErrorType.USER,
          },
          path: ['maxInputTokens'],
        })
      }
    } catch {
      // Model not found in registry - validation already handled above
    }
  }
})

/**
 * Input type for LLM config (what users provide).
 */
export type LLMConfig = z.input<typeof LLMConfigSchema>

/**
 * Output type for validated LLM config (after defaults applied).
 */
export type ValidatedLLMConfig = z.output<typeof LLMConfigSchema>

/**
 * PATCH-like schema for LLM config updates (e.g., model switching).
 * All fields are optional, but at least model or provider must be specified.
 */
export const LLMUpdatesSchema = z
  .object({...LLMConfigFields})
  .partial()
  .superRefine((data, ctx) => {
    // Require at least one meaningful change field: model or provider
    if (!data.model && !data.provider) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least model or provider must be specified for LLM update',
        path: [],
      })
    }
  })

/**
 * Input type for LLM updates.
 */
export type LLMUpdates = z.input<typeof LLMUpdatesSchema>

/**
 * Validate LLM configuration and return validated result.
 * @param config - Raw configuration input
 * @returns Validated configuration with defaults applied
 * @throws ZodError if validation fails
 */
export function validateLLMConfig(config: LLMConfig): ValidatedLLMConfig {
  return LLMConfigSchema.parse(config)
}

/**
 * Safely validate LLM configuration without throwing.
 * @param config - Raw configuration input
 * @returns SafeParseResult with success flag and data or error
 */
export function safeParseLLMConfig(config: unknown): z.SafeParseReturnType<LLMConfig, ValidatedLLMConfig> {
  return LLMConfigSchema.safeParse(config)
}

/**
 * Validate LLM updates (partial config for switching).
 * @param updates - Partial configuration updates
 * @returns Validated updates
 * @throws ZodError if validation fails
 */
export function validateLLMUpdates(updates: LLMUpdates): LLMUpdates {
  return LLMUpdatesSchema.parse(updates)
}
