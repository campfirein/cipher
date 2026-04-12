import type {WizardAnswers} from './config-scaffolder.js'
import type {DetectedProvider} from './provider-detector.js'

/**
 * Error thrown when the user cancels the wizard.
 */
export class WizardCancelledError extends Error {
  public override readonly name = 'WizardCancelledError'

  constructor(message = 'Wizard cancelled by user') {
    super(message)
  }
}

/**
 * Sentinel error thrown by prompt implementations to signal ESC back-navigation.
 * The wizard catches this and returns to the previous step.
 */
export class EscBackError extends Error {
  public override readonly name = 'EscBackError'

  constructor() {
    super('ESC back')
  }
}

/**
 * Injectable prompts interface for the onboarding wizard.
 * Tests inject mock implementations; production uses real `@inquirer/prompts`.
 */
export interface MemoryWizardPrompts {
  /**
   * Ask user to configure budget for cloud providers.
   */
  configureBudget(): Promise<{globalMonthlyCents: number}>

  /**
   * Ask user whether to enable enrichment (provider chaining).
   * Shown when 2+ providers are selected. Returns true to enable, false to skip.
   */
  configureEnrichment(providerIds: string[]): Promise<boolean>

  /**
   * Ask user to configure a specific provider (vault path, API key, etc.)
   */
  configureProvider(provider: DetectedProvider): Promise<Record<string, unknown>>

  /**
   * Confirm that the wizard should write the config file.
   */
  confirmWrite(summary: string): Promise<boolean>

  /**
   * Ask user to select which providers to enable from detected list.
   * Returns array of indices into the detected array (as strings).
   * Using indices instead of IDs supports multiple entries with the same provider type.
   */
  selectProviders(detected: DetectedProvider[]): Promise<string[]>
}

/**
 * Providers whose config schema supports only a single instance.
 * Duplicates produce a warning shown in the summary before confirm.
 */
const SINGLE_INSTANCE_PROVIDERS = new Set(['byterover', 'gbrain', 'hindsight', 'honcho', 'obsidian'])

/**
 * Detect duplicate single-instance providers and return user-facing warnings.
 * local-markdown is excluded because its folders array supports merging.
 */
function detectDuplicateWarnings(providers: WizardAnswers['providers']): string[] {
  const warnings: string[] = []
  const seen = new Map<string, Record<string, unknown>>()

  for (const provider of providers) {
    if (!provider.enabled) continue
    if (!SINGLE_INSTANCE_PROVIDERS.has(provider.id)) continue

    const previous = seen.get(provider.id)
    if (previous) {
      const droppedDetail = previous.vault_path ?? previous.repo_path ?? previous.connection_string ?? provider.id
      warnings.push(
        `Warning: Multiple ${provider.id} entries selected but config only supports one. ` +
        `Earlier entry (${droppedDetail}) will be dropped; keeping the last.`
      )
    }

    seen.set(provider.id, provider.config)
  }

  return warnings
}

/**
 * Build a summary string for the confirmation step.
 */
function buildSummary(
  providers: WizardAnswers['providers'],
  _budget?: WizardAnswers['budget'],  // Temporarily disabled — re-enable in Phase 3
  duplicateWarnings?: string[],
  enrichment?: boolean
): string {
  const localCount = providers.filter((p) => p.enabled).length
  const lines = [
    `Providers: ${localCount}`,
    ...providers.filter((p) => p.enabled).map((p) => `  - ${p.id}`),
  ]

  // Budget temporarily disabled — re-enable in Phase 3 with cloud providers.
  // if (budget) {
  //   lines.push(`Budget: $${(budget.globalMonthlyCents / 100).toFixed(2)}/month`)
  // } else {
  //   lines.push('Budget: $0/month (local only)')
  // }

  lines.push('Strategy: adaptive routing', `Enrichment: ${enrichment === false ? 'off (all parallel)' : 'on (providers feed context to each other)'}`)

  if (duplicateWarnings && duplicateWarnings.length > 0) {
    lines.push('', ...duplicateWarnings)
  }

  return lines.join('\n')
}

// Budget step temporarily disabled — add 'budget' back when re-enabling in Phase 3.
type WizardStep = 'configure' | 'confirm' | 'enrichment' | 'select'

/**
 * Resolve selected keys (indices) to detected provider entries,
 * ensuring byterover is always included.
 */
function resolveSelectedProviders(
  selectedKeys: string[],
  detected: DetectedProvider[]
): DetectedProvider[] {
  const selected = selectedKeys
    .map((key) => detected[Number(key)])
    .filter((p): p is DetectedProvider => p !== undefined)

  if (!selected.some((p) => p.id === 'byterover')) {
    const brvEntry = detected.find((p) => p.id === 'byterover')
    if (brvEntry) {
      selected.unshift(brvEntry)
    }
  }

  return selected
}

/**
 * Configure each selected provider, returning wizard provider entries.
 */
async function configureProviders(
  prompts: MemoryWizardPrompts,
  selectedProviders: DetectedProvider[]
): Promise<WizardAnswers['providers']> {
  const providers: WizardAnswers['providers'] = []

  for (const detectedProvider of selectedProviders) {
    if (detectedProvider.id === 'byterover') {
      providers.push({config: {}, enabled: true, id: 'byterover'})
      continue
    }

    // eslint-disable-next-line no-await-in-loop -- user-facing prompts must stay sequential
    const config = await prompts.configureProvider(detectedProvider)
    providers.push({config, enabled: true, id: detectedProvider.id})
  }

  return providers
}

/**
 * Run the memory swarm onboarding wizard.
 *
 * Orchestrates: select → configure → budget → confirm.
 * ESC back-navigation: prompts throw `EscBackError` to go back one step.
 * Ctrl+C propagates as-is (handled by the command).
 *
 * @param prompts - Injectable prompt functions
 * @param detected - Pre-scanned providers from detectProviders()
 * @returns Wizard answers ready for scaffoldConfig()
 * @throws WizardCancelledError if user declines to write
 */
export async function runMemoryWizard(
  prompts: MemoryWizardPrompts,
  detected: DetectedProvider[]
): Promise<WizardAnswers> {
  let step: WizardStep = 'select'
  let selectedProviders: DetectedProvider[] = []
  let providers: WizardAnswers['providers'] = []
  let enrichment: boolean | undefined

  /** Whether enrichment step should be shown (2+ providers including byterover) */
  const shouldAskEnrichment = () =>
    selectedProviders.length >= 2 && selectedProviders.some((p) => p.id === 'byterover')

  /* eslint-disable no-await-in-loop -- wizard steps are inherently sequential (user-facing prompts) */

  // Step-based loop with ESC back-navigation
  // Flow: select → configure → enrichment → confirm
  // Budget step temporarily disabled — re-enable in Phase 3 with cloud providers.
  while (true) {
    try {
      switch (step) {
        // Budget temporarily disabled — re-enable when cloud providers are wired.
        // case 'budget': {
        //   budget = await prompts.configureBudget()
        //   step = 'confirm'
        //   break
        // }

        case 'configure': {
          providers = await configureProviders(prompts, selectedProviders)
          step = shouldAskEnrichment() ? 'enrichment' : 'confirm'

          break
        }

        case 'confirm': {
          const duplicateWarnings = detectDuplicateWarnings(providers)
          const summary = buildSummary(providers, undefined, duplicateWarnings, enrichment)
          const confirmed = await prompts.confirmWrite(summary)
          if (!confirmed) {
            throw new WizardCancelledError()
          }

          return {enrichment, providers}
        }

        case 'enrichment': {
          const providerIds = providers.filter((p) => p.enabled).map((p) => p.id)
          enrichment = await prompts.configureEnrichment(providerIds)
          step = 'confirm'

          break
        }

        case 'select': {
          const selectedKeys = await prompts.selectProviders(detected)
          selectedProviders = resolveSelectedProviders(selectedKeys, detected)
          step = 'configure'

          break
        }
      }
    } catch (error) {
      if (error instanceof EscBackError) {
        // Go back one step
        switch (step) {
          case 'configure': {
            step = 'select'

            break
          }

          case 'confirm': {
            step = shouldAskEnrichment() ? 'enrichment' : 'configure'

            break
          }

          case 'enrichment': {
            step = 'configure'

            break
          }

          default: {
            // Already at first step — ignore ESC
            break
          }
        }

        continue
      }

      throw error
    }
  }
}
