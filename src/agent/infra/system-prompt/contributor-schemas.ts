import {z} from 'zod'

/**
 * Base schema for all contributor configurations.
 */
const BaseContributorSchema = z.object({
  enabled: z.boolean().optional().default(true).describe('Whether this contributor is enabled'),
  id: z.string().min(1).describe('Unique identifier for this contributor'),
  priority: z.number().int().nonnegative().describe('Execution priority (lower = first)'),
})

/**
 * Schema for static contributors.
 * Returns inline content directly.
 */
export const StaticContributorConfigSchema = BaseContributorSchema.extend({
  content: z.string().min(1).describe('Static content to include in the prompt'),
  type: z.literal('static'),
}).strict()

/**
 * Schema for file contributors.
 * Loads content from YAML files.
 */
export const FileContributorConfigSchema = BaseContributorSchema.extend({
  filepath: z.string().min(1).describe('Path to YAML prompt file'),
  options: z
    .object({
      cache: z.boolean().optional().default(true).describe('Whether to cache file contents'),
      validateMtime: z.boolean().optional().default(true).describe('Whether to validate file modification time'),
    })
    .strict()
    .optional(),
  type: z.literal('file'),
}).strict()

/**
 * Schema for memory contributor options.
 */
export const MemoryContributorOptionsSchema = z
  .object({
    includeTags: z.boolean().optional().default(true).describe('Whether to include tags in memory display'),
    limit: z.number().int().positive().optional().default(20).describe('Maximum number of memories to include'),
    pinnedOnly: z.boolean().optional().default(false).describe('Only include pinned memories'),
  })
  .strict()

/**
 * Schema for memory contributors.
 * Loads memories from the memory manager.
 */
export const MemoryContributorConfigSchema = BaseContributorSchema.extend({
  options: MemoryContributorOptionsSchema.optional(),
  type: z.literal('memory'),
}).strict()

/**
 * Schema for environment contributors.
 * Provides environment context (working directory, git status, etc.).
 */
export const EnvironmentContributorConfigSchema = BaseContributorSchema.extend({
  type: z.literal('environment'),
}).strict()

/**
 * Schema for datetime contributors.
 * Provides current date and time.
 */
export const DateTimeContributorConfigSchema = BaseContributorSchema.extend({
  type: z.literal('dateTime'),
}).strict()

/**
 * Discriminated union schema for all contributor configurations.
 */
export const ContributorConfigSchema = z
  .discriminatedUnion('type', [
    StaticContributorConfigSchema,
    FileContributorConfigSchema,
    MemoryContributorConfigSchema,
    EnvironmentContributorConfigSchema,
    DateTimeContributorConfigSchema,
  ])
  .describe('System prompt contributor configuration')

/**
 * Schema for the system prompt manager configuration.
 */
export const SystemPromptManagerConfigSchema = z
  .object({
    contributors: z.array(ContributorConfigSchema).min(1).describe('Array of contributor configurations'),
  })
  .strict()
  .describe('System prompt manager configuration')

// Type exports
export type ValidatedStaticContributorConfig = z.infer<typeof StaticContributorConfigSchema>
export type ValidatedFileContributorConfig = z.infer<typeof FileContributorConfigSchema>
export type ValidatedMemoryContributorConfig = z.infer<typeof MemoryContributorConfigSchema>
export type ValidatedEnvironmentContributorConfig = z.infer<typeof EnvironmentContributorConfigSchema>
export type ValidatedDateTimeContributorConfig = z.infer<typeof DateTimeContributorConfigSchema>
export type ValidatedContributorConfig = z.infer<typeof ContributorConfigSchema>
export type ValidatedSystemPromptManagerConfig = z.infer<typeof SystemPromptManagerConfigSchema>
