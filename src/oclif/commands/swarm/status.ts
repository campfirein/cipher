import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'

import {loadSwarmConfig} from '../../../agent/infra/swarm/config/swarm-config-loader.js'
import {validateSwarmProviders} from '../../../agent/infra/swarm/validation/config-validator.js'
import {detectProviders} from '../../../agent/infra/swarm/wizard/provider-detector.js'

type DetectedProviders = Awaited<ReturnType<typeof detectProviders>>
type SwarmConfig = Awaited<ReturnType<typeof loadSwarmConfig>>

/**
 * Format enrichment edges for display.
 */
export function formatEnrichmentEdges(edges: Array<{from: string; to: string}>): string[] {
  return edges.map((e) => `${e.from} → ${e.to}`)
}

/**
 * Collect configured paths for path-based providers so we can detect
 * newly discovered paths that aren't in the config yet.
 */
export function getConfiguredSwarmPaths(config: SwarmConfig): Set<string> {
  const paths = new Set<string>()
  const {providers} = config

  if (providers.obsidian?.vaultPath) {
    paths.add(providers.obsidian.vaultPath)
  }

  if (providers.localMarkdown?.folders) {
    for (const folder of providers.localMarkdown.folders) {
      paths.add(folder.path)
    }
  }

  // GBrain: repoPath is the brain data repo, not the detected CLI checkout path — do not add here.

  return paths
}

/**
 * Build user-facing suggestions for detected providers that are not yet configured.
 */
export function findSwarmStatusSuggestions(
  config: SwarmConfig,
  detected: DetectedProviders
): string[] {
  const suggestions: string[] = []
  const configuredPaths = getConfiguredSwarmPaths(config)

  for (const provider of detected) {
    if (!provider.detected) continue
    if (provider.id === 'byterover') continue

    // GBrain: `provider.path` is the CLI/source checkout; config uses `repoPath` for brain data — never compare.
    if (provider.id === 'gbrain') {
      if (!config.providers.gbrain) {
        const detail = provider.path ? ` at ${provider.path}` : ''
        suggestions.push(
          `Found gbrain${detail} — not in config. Run \`brv swarm onboard\` to add it.`
        )
      }

      continue
    }

    if (provider.path) {
      if (!configuredPaths.has(provider.path)) {
        suggestions.push(
          `Found ${provider.id} at ${provider.path} — not in config. Run \`brv swarm onboard\` to add it.`
        )
      }

      continue
    }

    const providerKey = provider.id === 'local-markdown' ? 'localMarkdown' : provider.id
    const configured = (config.providers as Record<string, unknown>)[providerKey]
    if (!configured) {
      const detail = provider.envVar ? `(${provider.envVar} is set)` : ''
      suggestions.push(
        `Found ${provider.id} ${detail} — not in config. Run \`brv swarm onboard\` to add it.`
      )
    }
  }

  return suggestions
}

export default class SwarmStatus extends Command {
  public static description = 'Show memory swarm provider health and connection status'
  public static examples = [
    '<%= config.bin %> swarm status',
    '<%= config.bin %> swarm status --format json',
  ]
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(SwarmStatus)
    const isJson = flags.format === 'json'

    try {
      // Load config
      const config = await loadSwarmConfig(process.cwd())

      // Run runtime validation
      const validation = await validateSwarmProviders(config)

      // Detect unconfigured providers (proactive suggestions)
      const detected = await detectProviders()
      const suggestions = findSwarmStatusSuggestions(config, detected)

      if (isJson) {
        this.logJson({
          config: {
            enrichment: {edges: config.enrichment?.edges ?? []},
            providers: Object.keys(config.providers).filter(
              (k) => (config.providers as Record<string, {enabled?: boolean}>)[k]?.enabled
            ),
          },
          errors: validation.errors,
          suggestions,
          warnings: validation.warnings,
        })
      } else {
        this.renderTextOutput(config, validation, suggestions)
      }
    } catch (error) {
      if (isJson) {
        this.logJson({error: (error as Error).message, success: false})
      } else {
        this.log(chalk.red((error as Error).message))
      }
    }
  }

  private findSuggestions(
    config: SwarmConfig,
    detected: DetectedProviders
  ): string[] {
    return findSwarmStatusSuggestions(config, detected)
  }

  private renderCascadeNote(
    validation: Awaited<ReturnType<typeof validateSwarmProviders>>
  ): void {
    if (!validation.cascadeNote) return

    this.log(`\n${chalk.dim('Note:')} ${validation.cascadeNote}`)
  }

  private renderEnrichmentTopology(
    config: Awaited<ReturnType<typeof loadSwarmConfig>>
  ): void {
    const edges = config.enrichment?.edges ?? []
    if (edges.length === 0) return

    const lines = formatEnrichmentEdges(edges)
    this.log(`\n${chalk.cyan('Enrichment Topology')}:`)
    for (const line of lines) {
      this.log(`  ${line}`)
    }
  }

  private renderProviderLine(
    name: string,
    ok: boolean,
    detail: string,
    status?: 'disabled' | 'warning'
  ): void {
    if (status === 'disabled') {
      this.log(`  ${chalk.dim('—')} ${name.padEnd(15)} ${chalk.dim(detail)}`)
    } else if (status === 'warning') {
      this.log(`  ${chalk.yellow('⚠')} ${name.padEnd(15)} ${detail}`)
    } else if (ok) {
      this.log(`  ${chalk.green('✓')} ${name.padEnd(15)} ${detail}`)
    } else {
      this.log(`  ${chalk.red('✗')} ${name.padEnd(15)} ${detail}`)
    }
  }

  private renderProviderStatusLines(
    config: Awaited<ReturnType<typeof loadSwarmConfig>>,
    validation: Awaited<ReturnType<typeof validateSwarmProviders>>
  ): void {
    const {providers} = config
    this.renderProviderLine('ByteRover', providers.byterover.enabled, 'context-tree (always on)')

    if (providers.obsidian) {
      const hasError = validation.errors.some((e) => e.provider === 'obsidian')
      const hasWarning = validation.warnings.some((w) => w.provider === 'obsidian')
      this.renderProviderLine(
        'Obsidian',
        providers.obsidian.enabled && !hasError,
        providers.obsidian.vaultPath,
        hasWarning ? 'warning' : undefined
      )
    } else {
      this.renderProviderLine('Obsidian', false, 'not configured', 'disabled')
    }

    if (providers.localMarkdown) {
      const hasError = validation.errors.some((e) => e.provider === 'local-markdown')
      const folderCount = providers.localMarkdown.folders.length
      this.renderProviderLine(
        'Local .md',
        providers.localMarkdown.enabled && !hasError,
        `${folderCount} folder(s)`
      )
    } else {
      this.renderProviderLine('Local .md', false, 'not configured', 'disabled')
    }

    // Honcho and Hindsight temporarily disabled — adapters coming in Phase 3.
    // When re-enabled, uncomment these blocks:
    // if (providers.honcho) {
    //   const hasError = validation.errors.some((e) => e.provider === 'honcho')
    //   this.renderProviderLine('Honcho', providers.honcho.enabled && !hasError, 'cloud API')
    // } else {
    //   this.renderProviderLine('Honcho', false, 'not configured', 'disabled')
    // }
    // if (providers.hindsight) {
    //   const hasError = validation.errors.some((e) => e.provider === 'hindsight')
    //   this.renderProviderLine('Hindsight', providers.hindsight.enabled && !hasError, 'Postgres')
    // } else {
    //   this.renderProviderLine('Hindsight', false, 'not configured', 'disabled')
    // }

    if (providers.gbrain) {
      const hasError = validation.errors.some((e) => e.provider === 'gbrain')
      this.renderProviderLine('GBrain', providers.gbrain.enabled && !hasError, providers.gbrain.repoPath)
    } else {
      this.renderProviderLine('GBrain', false, 'not configured', 'disabled')
    }
  }

  private renderSuggestionLines(suggestions: string[]): void {
    if (suggestions.length === 0) return

    this.log(`\n${chalk.cyan('Suggestions')}:`)
    for (const suggestion of suggestions) {
      this.log(`  • ${suggestion}`)
    }
  }

  private renderSwarmSummary(
    config: Awaited<ReturnType<typeof loadSwarmConfig>>,
    validation: Awaited<ReturnType<typeof validateSwarmProviders>>
  ): void {
    const {providers} = config
    const enabledCount = [
      providers.byterover.enabled,
      providers.obsidian?.enabled,
      providers.localMarkdown?.enabled,
      // Honcho and Hindsight temporarily disabled
      providers.gbrain?.enabled,
    ].filter(Boolean).length

    const errorCount = validation.errors.length
    const status = errorCount === 0
      ? chalk.green('operational')
      : chalk.yellow('degraded')

    this.log(`\nSwarm is ${status} (${enabledCount}/4 providers configured).`)
  }

  private renderTextOutput(
    config: Awaited<ReturnType<typeof loadSwarmConfig>>,
    validation: Awaited<ReturnType<typeof validateSwarmProviders>>,
    suggestions: string[]
  ): void {
    this.log(chalk.bold('\nMemory Swarm Health Check'))
    this.log('═'.repeat(40))

    this.renderProviderStatusLines(config, validation)
    this.renderEnrichmentTopology(config)
    this.renderWriteTargets(config)
    this.renderValidationErrors(validation)
    this.renderValidationWarnings(validation)
    this.renderCascadeNote(validation)
    this.renderSuggestionLines(suggestions)
    this.renderSwarmSummary(config, validation)
  }

  private renderValidationErrors(
    validation: Awaited<ReturnType<typeof validateSwarmProviders>>
  ): void {
    if (validation.errors.length === 0) return

    this.log(`\n${chalk.red('Errors')} (${validation.errors.length}):`)
    for (const [i, error] of validation.errors.entries()) {
      this.log(`  ${i + 1}. ${error.provider ?? 'config'}: ${error.message}`)
      if (error.suggestion) {
        this.log(`     ${chalk.dim(error.suggestion)}`)
      }
    }
  }

  private renderValidationWarnings(
    validation: Awaited<ReturnType<typeof validateSwarmProviders>>
  ): void {
    if (validation.warnings.length === 0) return

    this.log(`\n${chalk.yellow('Warnings')} (${validation.warnings.length}):`)
    for (const [i, warning] of validation.warnings.entries()) {
      this.log(`  ${i + 1}. ${warning.provider ?? 'config'}: ${warning.message}`)
    }
  }

  private renderWriteTargets(
    config: Awaited<ReturnType<typeof loadSwarmConfig>>
  ): void {
    const {providers} = config
    const targets: string[] = []

    if (providers.gbrain?.enabled) {
      targets.push('gbrain (entity, general)')
    }

    if (providers.localMarkdown?.enabled) {
      for (const folder of providers.localMarkdown.folders) {
        if (!folder.readOnly) {
          targets.push(`local-markdown:${folder.name} (note, general)`)
        }
      }
    }

    if (targets.length === 0) return

    this.log(`\n${chalk.cyan('Write Targets')}:`)
    for (const target of targets) {
      this.log(`  ${target}`)
    }
  }
}
