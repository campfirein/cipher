import {existsSync} from 'node:fs'
import {join} from 'node:path'

import type {SwarmConfig} from '../config/swarm-config-schema.js'
import type {ValidationIssue} from './memory-swarm-validation-error.js'

import {isCloudProvider} from '../../../core/domain/swarm/types.js'

/**
 * Result of runtime provider validation.
 */
export type ProviderValidationResult = {
  cascadeNote?: string
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

/**
 * Check if a string value looks like an unresolved env var reference.
 */
function isUnresolvedEnvVar(value: string): boolean {
  return /^\$\{\w+\}$/.test(value)
}

/**
 * Check if a credential string is effectively unusable:
 * empty, whitespace-only, or an unresolved env var placeholder.
 */
function isInvalidCredential(value: string): 'empty' | 'unresolved' | undefined {
  if (value.trim().length === 0) return 'empty'
  if (isUnresolvedEnvVar(value)) return 'unresolved'

  return undefined
}

/**
 * Validate obsidian provider config at runtime.
 */
function validateObsidian(
  config: NonNullable<SwarmConfig['providers']['obsidian']>,
  errors: ValidationIssue[],
  warnings: ValidationIssue[]
): void {
  const {vaultPath} = config

  if (!existsSync(vaultPath)) {
    errors.push({
      field: 'vault_path',
      message: `Obsidian vault not found at ${vaultPath}`,
      provider: 'obsidian',
      suggestion: `Verify the path exists or run \`brv swarm onboard\` to reconfigure.`,
    })

    return
  }

  if (!existsSync(join(vaultPath, '.obsidian'))) {
    warnings.push({
      field: 'vault_path',
      message: `Path ${vaultPath} exists but has no .obsidian/ directory. It may not be an Obsidian vault.`,
      provider: 'obsidian',
      suggestion: `Ensure this is the correct vault path.`,
    })
  }
}

/**
 * Validate local-markdown provider config at runtime.
 */
function validateLocalMarkdown(
  config: NonNullable<SwarmConfig['providers']['localMarkdown']>,
  errors: ValidationIssue[]
): void {
  for (const folder of config.folders) {
    if (!existsSync(folder.path)) {
      errors.push({
        field: 'folders.path',
        message: `Folder ${folder.path} (${folder.name}) not found`,
        provider: 'local-markdown',
        suggestion: `Create the folder or update the path in config.`,
      })
    }
  }
}

/**
 * Validate honcho provider config at runtime.
 */
function validateHoncho(
  config: NonNullable<SwarmConfig['providers']['honcho']>,
  errors: ValidationIssue[]
): void {
  const keyReason = isInvalidCredential(config.apiKey)
  if (keyReason === 'empty') {
    errors.push({
      field: 'api_key',
      message: `Honcho API key is empty`,
      provider: 'honcho',
      suggestion: `Set the HONCHO_API_KEY environment variable or provide a valid key.`,
    })
  } else if (keyReason === 'unresolved') {
    errors.push({
      field: 'api_key',
      message: `Honcho API key is unresolved: ${config.apiKey}`,
      provider: 'honcho',
      suggestion: `Set the HONCHO_API_KEY environment variable.`,
    })
  }

  if (config.appId.trim().length === 0) {
    errors.push({
      field: 'app_id',
      message: `Honcho app_id is empty`,
      provider: 'honcho',
      suggestion: `Provide a valid Honcho app ID in config.`,
    })
  }
}

/**
 * Validate hindsight provider config at runtime.
 */
function validateHindsight(
  config: NonNullable<SwarmConfig['providers']['hindsight']>,
  errors: ValidationIssue[]
): void {
  const reason = isInvalidCredential(config.connectionString)
  if (reason) {
    errors.push({
      field: 'connection_string',
      message: reason === 'empty'
        ? `Hindsight connection string is empty`
        : `Hindsight connection string is unresolved: ${config.connectionString}`,
      provider: 'hindsight',
      suggestion: `Set the HINDSIGHT_DB_URL environment variable.`,
    })

    return
  }

  // Validate it looks like a postgres:// URL
  if (!config.connectionString.startsWith('postgres://') && !config.connectionString.startsWith('postgresql://')) {
    errors.push({
      field: 'connection_string',
      message: `Hindsight connection string does not look like a valid Postgres URL: ${config.connectionString}`,
      provider: 'hindsight',
      suggestion: `Expected format: postgres://user:password@host:port/database`,
    })
  }
}

/**
 * Validate gbrain provider config at runtime.
 */
function validateGBrain(
  config: NonNullable<SwarmConfig['providers']['gbrain']>,
  errors: ValidationIssue[]
): void {
  if (!existsSync(config.repoPath)) {
    errors.push({
      field: 'repo_path',
      message: `GBrain repo not found at ${config.repoPath}`,
      provider: 'gbrain',
      suggestion: `Verify the path or run \`brv swarm onboard\` to reconfigure.`,
    })
  }
}

/**
 * Run runtime validation on all enabled providers.
 * Checks paths exist, env vars are resolved, connections are reachable.
 * Returns accumulated errors and warnings (never throws).
 */
export async function validateSwarmProviders(
  config: SwarmConfig
): Promise<ProviderValidationResult> {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const {providers} = config

  // ByteRover is always valid (built-in)

  if (providers.obsidian?.enabled) {
    validateObsidian(providers.obsidian, errors, warnings)
  }

  if (providers.localMarkdown?.enabled) {
    validateLocalMarkdown(providers.localMarkdown, errors)
  }

  if (providers.honcho?.enabled) {
    validateHoncho(providers.honcho, errors)
  }

  if (providers.hindsight?.enabled) {
    validateHindsight(providers.hindsight, errors)
  }

  if (providers.gbrain?.enabled) {
    validateGBrain(providers.gbrain, errors)
  }

  // Generate cascade note if cloud providers failed
  const cloudErrors = errors.filter((e) =>
    e.provider && isCloudProvider(e.provider as 'gbrain' | 'hindsight' | 'honcho')
  )
  const cascadeNote = cloudErrors.length > 0
    ? `${cloudErrors.length} cloud provider(s) failed validation. Routing will use local providers only until resolved.`
    : undefined

  return {cascadeNote, errors, warnings}
}
