import {execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {join} from 'node:path'

import type {SwarmConfig} from '../config/swarm-config-schema.js'
import type {ValidationIssue} from './memory-swarm-validation-error.js'

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

    return
  }

  // Verify gbrain CLI is invokable.
  // Check: is `gbrain` in PATH, or does src/cli.ts exist in repo/workspace (Bun fallback)?
  let gbrainReachable = false

  // Option A: gbrain globally installed
  try {
    execFileSync('gbrain', ['--version'], {encoding: 'utf8', stdio: 'pipe', timeout: 5000})
    gbrainReachable = true
  } catch {
    // Not in PATH
  }

  // Option B: local Bun script (repoPath or workspace sibling)
  if (!gbrainReachable) {
    const candidates = [
      join(config.repoPath, 'src', 'cli.ts'),
      join(process.cwd(), '..', 'gbrain', 'src', 'cli.ts'),
    ]
    const scriptFound = candidates.some((p) => existsSync(p))

    if (scriptFound) {
      // Script exists — verify bun is available to run it
      try {
        execFileSync('bun', ['--version'], {encoding: 'utf8', stdio: 'pipe', timeout: 5000})
        gbrainReachable = true
      } catch {
        errors.push({
          field: 'gbrain',
          message: `GBrain source found but \`bun\` is not installed. GBrain requires Bun to run from source.`,
          provider: 'gbrain',
          suggestion: `Install Bun: https://bun.sh/docs/installation`,
        })

        return
      }
    }
  }

  if (!gbrainReachable) {
    errors.push({
      field: 'gbrain',
      message: `GBrain CLI not found. Not in PATH and no src/cli.ts in ${config.repoPath}`,
      provider: 'gbrain',
      suggestion: `Install globally with \`bun add -g gbrain\`, or set repo_path to the gbrain source directory.`,
    })
  }
}

/**
 * Collect the set of provider IDs that are enabled in config.
 * Uses prefix matching (e.g., `local-markdown` matches if any local-markdown folder exists).
 */
function getEnabledProviderIds(providers: SwarmConfig['providers']): Set<string> {
  const ids = new Set<string>()
  if (providers.byterover.enabled) ids.add('byterover')
  if (providers.obsidian?.enabled) ids.add('obsidian')
  if (providers.localMarkdown?.enabled) {
    ids.add('local-markdown')
    for (const folder of providers.localMarkdown.folders) {
      ids.add(`local-markdown:${folder.name}`)
    }
  }

  if (providers.honcho?.enabled) ids.add('honcho')
  if (providers.hindsight?.enabled) ids.add('hindsight')
  if (providers.gbrain?.enabled) ids.add('gbrain')
  if (providers.memoryWiki?.enabled) ids.add('memory-wiki')

  return ids
}

/**
 * Check if a provider ID matches an enabled provider (with prefix matching).
 */
function matchesEnabledProvider(edgeEndpoint: string, enabledIds: Set<string>): boolean {
  if (enabledIds.has(edgeEndpoint)) return true
  // Prefix match: "local-markdown" matches "local-markdown:notes"
  for (const id of enabledIds) {
    if (id.startsWith(`${edgeEndpoint}:`)) return true
  }

  return false
}

/**
 * Check if a provider ID references a configured (but possibly disabled) provider.
 */
function isConfiguredProvider(edgeEndpoint: string, providers: SwarmConfig['providers']): boolean {
  if (edgeEndpoint === 'byterover') return true
  if (edgeEndpoint === 'obsidian') return providers.obsidian !== undefined
  if (edgeEndpoint === 'honcho') return providers.honcho !== undefined
  if (edgeEndpoint === 'hindsight') return providers.hindsight !== undefined
  if (edgeEndpoint === 'gbrain') return providers.gbrain !== undefined
  if (edgeEndpoint === 'memory-wiki') return providers.memoryWiki !== undefined

  // Generic "local-markdown" — valid if the section exists
  if (edgeEndpoint === 'local-markdown') return providers.localMarkdown !== undefined

  // Folder-scoped "local-markdown:<name>" — must match an actual configured folder
  if (edgeEndpoint.startsWith('local-markdown:')) {
    const folderName = edgeEndpoint.slice('local-markdown:'.length)

    return providers.localMarkdown?.folders.some((f) => f.name === folderName) ?? false
  }

  return false
}

/**
 * Detect cycles in enrichment edges using DFS.
 */
function hasCycle(edges: Array<{from: string; to: string}>): boolean {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const existing = adjacency.get(edge.from) ?? []
    existing.push(edge.to)
    adjacency.set(edge.from, existing)
  }

  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(node: string): boolean {
    if (inStack.has(node)) return true
    if (visited.has(node)) return false
    visited.add(node)
    inStack.add(node)
    for (const neighbor of adjacency.get(node) ?? []) {
      if (dfs(neighbor)) return true
    }

    inStack.delete(node)

    return false
  }

  const allNodes = new Set([...edges.map((e) => e.from), ...edges.map((e) => e.to)])
  for (const node of allNodes) {
    if (dfs(node)) return true
  }

  return false
}

/**
 * Expand a config edge endpoint to concrete provider IDs.
 * "local-markdown" → ["local-markdown:notes", "local-markdown:docs"]
 * "obsidian" → ["obsidian"]
 *
 * Prefers prefix expansion: if "local-markdown" has folder-scoped children,
 * expand to those children rather than treating the generic ID as concrete.
 */
function resolveEndpoint(endpoint: string, enabledIds: Set<string>): string[] {
  // Prefer prefix expansion over exact match — generic IDs like "local-markdown"
  // should expand to their concrete folder IDs, not stay as the generic form.
  const prefixMatches = [...enabledIds].filter((id) => id.startsWith(`${endpoint}:`))
  if (prefixMatches.length > 0) return prefixMatches

  if (enabledIds.has(endpoint)) return [endpoint]

  return [endpoint]
}

/**
 * Validate enrichment edges: no self-edges, no cycles, endpoints must exist.
 * Validates against the EXPANDED graph (generic endpoints resolved to concrete IDs)
 * so that expansion-induced cycles and self-edges are caught at config time.
 */
function validateEnrichmentEdges(
  config: SwarmConfig,
  errors: ValidationIssue[],
  warnings: ValidationIssue[]
): void {
  const configEdges = config.enrichment?.edges ?? []
  if (configEdges.length === 0) return

  const enabledIds = getEnabledProviderIds(config.providers)

  // 1. Check raw endpoint existence/enabled status
  for (const edge of configEdges) {
    for (const endpoint of [edge.from, edge.to]) {
      if (!isConfiguredProvider(endpoint, config.providers)) {
        errors.push({
          field: 'enrichment.edges',
          message: `Enrichment edge references unknown provider '${endpoint}'`,
          provider: 'enrichment',
        })
      } else if (!matchesEnabledProvider(endpoint, enabledIds)) {
        warnings.push({
          field: 'enrichment.edges',
          message: `Enrichment edge references disabled provider '${endpoint}'`,
          provider: 'enrichment',
        })
      }
    }
  }

  // 2. Expand only edges where BOTH endpoints are enabled.
  // Disabled endpoints already produced warnings above — don't let them
  // create phantom cycles or self-edges in the expanded graph.
  const seen = new Set<string>()
  const expanded: Array<{from: string; to: string}> = []
  for (const edge of configEdges) {
    if (!matchesEnabledProvider(edge.from, enabledIds) || !matchesEnabledProvider(edge.to, enabledIds)) {
      continue
    }

    const fromIds = resolveEndpoint(edge.from, enabledIds)
    const toIds = resolveEndpoint(edge.to, enabledIds)
    for (const from of fromIds) {
      for (const to of toIds) {
        const key = `${from}->${to}`
        if (!seen.has(key)) {
          seen.add(key)
          expanded.push({from, to})
        }
      }
    }
  }

  // 3. Self-edge check on expanded graph
  for (const edge of expanded) {
    if (edge.from === edge.to) {
      errors.push({
        field: 'enrichment.edges',
        message: `Enrichment self-edge after expansion: '${edge.from}' cannot enrich itself`,
        provider: 'enrichment',
        suggestion: `The generic endpoint expands to the same concrete provider on both sides.`,
      })
    }
  }

  // 4. Cycle detection on expanded graph
  if (hasCycle(expanded)) {
    errors.push({
      field: 'enrichment.edges',
      message: `Enrichment edges contain a cycle after expansion. The topology must be a directed acyclic graph (DAG).`,
      provider: 'enrichment',
      suggestion: `Generic endpoints like 'local-markdown' expand to concrete folder IDs, which may create cycles with specific endpoints. Remove one edge to break the cycle.`,
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

  if (providers.memoryWiki?.enabled && !existsSync(providers.memoryWiki.vaultPath)) {
      errors.push({
        field: 'providers.memory_wiki.vault_path',
        message: `Memory Wiki vault not found at ${providers.memoryWiki.vaultPath}`,
        provider: 'memory-wiki',
      })
    }

  // Validate enrichment edges
  validateEnrichmentEdges(config, errors, warnings)

  // Generate cascade note if cloud providers failed (exclude enrichment errors)
  const CLOUD_PROVIDER_IDS = new Set(['gbrain', 'hindsight', 'honcho'])
  const cloudErrors = errors.filter((e) =>
    e.provider && CLOUD_PROVIDER_IDS.has(e.provider)
  )
  const cascadeNote = cloudErrors.length > 0
    ? `${cloudErrors.length} cloud provider(s) failed validation. Routing will use local providers only until resolved.`
    : undefined

  return {cascadeNote, errors, warnings}
}
