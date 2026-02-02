import {z} from 'zod'

/**
 * LLM configuration schema with validation and defaults.
 */
export const LLMConfigSchema = z
  .object({
    maxIterations: z.number().positive().default(50).describe('Maximum agentic loop iterations'),
    maxTokens: z.number().positive().default(8192).describe('Maximum output tokens'),
    temperature: z.number().min(0).max(2).default(0.7).describe('Temperature for generation'),
    topK: z.number().positive().optional().describe('Top-K sampling parameter'),
    topP: z.number().min(0).max(1).optional().describe('Top-P (nucleus) sampling parameter'),
    verbose: z.boolean().default(false).describe('Enable verbose debug output'),
  })
  .strict()

export type LLMConfig = z.input<typeof LLMConfigSchema>
export type ValidatedLLMConfig = z.output<typeof LLMConfigSchema>

/**
 * Session configuration schema.
 */
export const SessionConfigSchema = z
  .object({
    maxSessions: z.number().positive().default(100).describe('Maximum concurrent sessions'),
    sessionTTL: z.number().positive().default(3_600_000).describe('Session TTL in milliseconds (1 hour default)'),
  })
  .strict()

export type SessionConfig = z.input<typeof SessionConfigSchema>
export type ValidatedSessionConfig = z.output<typeof SessionConfigSchema>

/**
 * File system configuration schema.
 */
export const FileSystemConfigSchema = z
  .object({
    allowedExtensions: z.array(z.string()).optional().describe('Allowed file extensions'),
    maxFileSize: z.number().positive().optional().describe('Maximum file size in bytes'),
    workingDirectory: z.string().optional().describe('Working directory for file operations'),
  })
  .strict()

export type FileSystemConfig = z.input<typeof FileSystemConfigSchema>
export type ValidatedFileSystemConfig = z.output<typeof FileSystemConfigSchema>

/**
 * Blob storage configuration schema.
 */
export const BlobStorageConfigSchema = z
  .object({
    maxBlobSize: z.number().positive().default(100 * 1024 * 1024).describe('Max blob size (100MB default)'),
    maxTotalSize: z.number().positive().default(1024 * 1024 * 1024).describe('Max total size (1GB default)'),
    storageDir: z.string().describe('Directory for blob storage'),
  })
  .strict()

export type BlobStorageConfig = z.input<typeof BlobStorageConfigSchema>
export type ValidatedBlobStorageConfig = z.output<typeof BlobStorageConfigSchema>

/**
 * Main agent configuration schema.
 * Combines all sub-schemas with validation and defaults.
 *
 * This schema validates and transforms raw config into a fully-typed
 * configuration with all defaults applied.
 */
export const AgentConfigSchema = z
  .object({
    apiBaseUrl: z.string().url().describe('ByteRover API base URL'),
    blobStorage: BlobStorageConfigSchema.optional().describe('Blob storage configuration'),
    fileSystem: FileSystemConfigSchema.optional().describe('File system configuration'),
    httpReferer: z.string().optional().describe('HTTP Referer for OpenRouter rankings'),
    llm: LLMConfigSchema.default({}).describe('LLM configuration'),
    model: z.string().min(1).describe('LLM model identifier'),
    openRouterApiKey: z.string().optional().describe('OpenRouter API key'),
    projectId: z.string().min(1).describe('ByteRover project ID'),
    region: z.string().optional().describe('API region'),
    sessionKey: z.string().default('').describe('ByteRover session key'),
    sessions: SessionConfigSchema.default({}).describe('Session management configuration'),
    siteName: z.string().optional().describe('Site name for OpenRouter rankings'),
    spaceId: z.string().optional().describe('ByteRover space ID'),
    teamId: z.string().optional().describe('ByteRover team ID'),
    useGranularStorage: z.boolean().default(false).describe('Enable granular history storage'),
  })
  .strict()

export type AgentConfig = z.input<typeof AgentConfigSchema>
export type ValidatedAgentConfig = z.output<typeof AgentConfigSchema>

/**
 * LLM updates schema for runtime config changes.
 * All fields optional - only provided fields will be updated.
 */
export const LLMUpdatesSchema = z
  .object({
    maxIterations: z.number().positive().optional(),
    maxTokens: z.number().positive().optional(),
    model: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    verbose: z.boolean().optional(),
  })
  .strict()

export type LLMUpdates = z.input<typeof LLMUpdatesSchema>

/**
 * Validate agent configuration.
 * Returns validated config with defaults applied, or throws on validation error.
 */
export function validateAgentConfig(config: unknown): ValidatedAgentConfig {
  return AgentConfigSchema.parse(config)
}

/**
 * Safely validate agent configuration.
 * Returns result object with success flag and either data or error.
 */
export function safeValidateAgentConfig(config: unknown): z.SafeParseReturnType<AgentConfig, ValidatedAgentConfig> {
  return AgentConfigSchema.safeParse(config)
}
