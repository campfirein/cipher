import {load} from 'js-yaml'
import {readFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {ZodError} from 'zod'

import {resolveEnvVars, type SwarmConfig, validateSwarmConfig} from './swarm-config-schema.js'

/**
 * Default path to the swarm config file relative to project root.
 */
const CONFIG_PATH = join('.brv', 'swarm', 'config.yaml')

/**
 * Expand a leading `~` to the user's home directory.
 * Handles both Unix (`~/`) and Windows (`~\\`) separators.
 * Node's fs APIs do not expand tilde, so we must do it ourselves.
 */
function expandTilde(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))

  return value
}

/**
 * Recursively resolve `${VAR}` env vars and expand `~/` in all string values.
 */
function resolveStringsDeep(
  obj: unknown,
  env: Record<string, string | undefined>
): unknown {
  if (typeof obj === 'string') {
    return expandTilde(resolveEnvVars(obj, env))
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveStringsDeep(item, env))
  }

  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveStringsDeep(value, env)
    }

    return result
  }

  return obj
}

/**
 * Load swarm config from `.brv/swarm/config.yaml`.
 *
 * 1. Read YAML file
 * 2. Resolve `${VAR}` env var references
 * 3. Parse and validate through Zod schema
 *
 * @param projectRoot - Project root directory containing `.brv/`
 * @param env - Environment variables (defaults to `process.env`)
 * @returns Validated swarm config
 * @throws Error if file not found, YAML invalid, or schema validation fails
 */
export async function loadSwarmConfig(
  projectRoot: string,
  env?: Record<string, string | undefined>
): Promise<SwarmConfig> {
  const configPath = join(projectRoot, CONFIG_PATH)

  let rawYaml: string
  try {
    rawYaml = readFileSync(configPath, 'utf8')
  } catch {
    throw new Error(
      `Swarm config not found at ${configPath}. Run \`brv swarm onboard\` to create one.`
    )
  }

  let parsed: unknown
  try {
    parsed = load(rawYaml)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse ${configPath}: ${detail}`)
  }

  const resolved = resolveStringsDeep(parsed, env ?? process.env)

  try {
    return validateSwarmConfig(resolved)
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) =>
        `  - ${issue.path.join('.')}: ${issue.message}`
      ).join('\n')
      throw new Error(`Invalid swarm config in ${configPath}:\n${issues}`)
    }

    throw error
  }
}
