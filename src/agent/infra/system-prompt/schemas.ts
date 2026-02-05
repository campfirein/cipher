import {z} from 'zod'

/**
 * Schema for prompt configuration loaded from YAML files.
 *
 * Either 'prompt' (single template) or 'prompts' (named templates) is required.
 *
 * Handles mapping from YAML snake_case (excluded_tools) to TypeScript camelCase (excludedTools).
 */
export const PromptConfigSchema = z
  .preprocess(
    (data) => {
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        const processed = {...(data as Record<string, unknown>)}

        // Map excluded_tools (YAML) to excludedTools (TypeScript)
        if ('excluded_tools' in processed && !('excludedTools' in processed)) {
          processed.excludedTools = processed.excluded_tools

          delete processed.excluded_tools
        }

        return processed
      }

      return data
    },
    z
      .object({
        description: z.string().optional().describe('Human-readable description of this prompt'),
        excludedTools: z.array(z.string()).optional().describe('Tools to exclude from this prompt mode'),
        prompt: z.string().optional().describe('Main prompt template content'),
        prompts: z.record(z.string()).optional().describe('Named prompt templates (e.g., for reflection types)'),
      })
      .strict()
      .refine((data) => data.prompt !== undefined || data.prompts !== undefined, {
        message: "Either 'prompt' or 'prompts' field is required",
      })
      .describe('Prompt configuration loaded from YAML'),
  )

/**
 * Validated prompt configuration type.
 */
export type ValidatedPromptConfig = z.infer<typeof PromptConfigSchema>

/**
 * Schema for conversation metadata.
 */
export const ConversationMetadataSchema = z
  .object({
    conversationId: z.string().optional().describe('Unique identifier for the conversation'),
    title: z.string().optional().describe('Title or topic of the conversation'),
  })
  .strict()

/**
 * Schema for build context passed to system prompt builder.
 *
 * Contains runtime information needed to construct the system prompt.
 */
export const BuildContextSchema = z
  .object({
    availableMarkers: z.record(z.string()).optional().describe('Available markers and their descriptions'),
    availableTools: z.array(z.string()).optional().describe('List of available tool names'),
    commandType: z.enum(['curate', 'query']).optional().describe('Type of command being executed'),
    conversationMetadata: ConversationMetadataSchema.optional().describe('Metadata about the current conversation'),
    environmentContext: z.any().optional().describe('Environment context object (validated separately)'),
    fileReferenceInstructions: z.string().optional().describe('Instructions for file reference handling'),
    memoryManager: z.any().optional().describe('Memory manager instance (runtime dependency)'),
  })
  .strict()
  .describe('Runtime context for building system prompts')

/**
 * Validated build context type.
 */
export type ValidatedBuildContext = z.infer<typeof BuildContextSchema>

/**
 * Schema for environment context builder options.
 */
export const EnvironmentContextOptionsSchema = z
  .object({
    includeBrvStructure: z
      .boolean()
      .optional()
      .default(true)
      .describe('Whether to include .brv directory structure explanation'),
    includeFileTree: z.boolean().optional().default(true).describe('Whether to include project file tree'),
    maxFileTreeDepth: z.number().int().positive().optional().default(3).describe('Maximum depth for file tree traversal'),
    maxFileTreeEntries: z
      .number()
      .int()
      .positive()
      .optional()
      .default(100)
      .describe('Maximum number of entries in file tree'),
    workingDirectory: z.string().min(1).describe('Absolute path to the working directory'),
  })
  .strict()
  .describe('Options for building environment context')

/**
 * Input type for environment context options (before validation/defaults).
 * Use this for function parameters.
 */
export type EnvironmentContextOptionsInput = z.input<typeof EnvironmentContextOptionsSchema>

/**
 * Validated environment context options type (after validation/defaults).
 * Use this for the result after parsing.
 */
export type ValidatedEnvironmentContextOptions = z.infer<typeof EnvironmentContextOptionsSchema>

/**
 * Schema for reflection prompt context.
 */
export const ReflectionContextSchema = z
  .object({
    currentIteration: z.number().int().positive().optional().describe('Current iteration number'),
    maxIterations: z.number().int().positive().optional().describe('Maximum iterations allowed'),
    type: z
      .enum(['completion_check', 'final_iteration', 'mid_point_check', 'near_max_iterations'])
      .describe('Type of reflection prompt to build'),
  })
  .strict()
  .describe('Context for building reflection prompts')

/**
 * Validated reflection context type.
 */
export type ValidatedReflectionContext = z.infer<typeof ReflectionContextSchema>
