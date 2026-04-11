/* eslint-disable camelcase -- wizard builds YAML-shaped config objects (snake_case keys) */
import {checkbox, confirm, input} from '@inquirer/prompts'
import {Command} from '@oclif/core'
import chalk from 'chalk'
import {load} from 'js-yaml'
import {existsSync, mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import type {DetectedProvider} from '../../../agent/infra/swarm/wizard/provider-detector.js'
import type {MemoryWizardPrompts} from '../../../agent/infra/swarm/wizard/swarm-wizard.js'

import {safeValidateSwarmConfig} from '../../../agent/infra/swarm/config/swarm-config-schema.js'
import {scaffoldConfig} from '../../../agent/infra/swarm/wizard/config-scaffolder.js'
import {detectProviders} from '../../../agent/infra/swarm/wizard/provider-detector.js'
import {EscBackError, runMemoryWizard, WizardCancelledError} from '../../../agent/infra/swarm/wizard/swarm-wizard.js'
import {createEscapeSignal, isEscBack, isForceExit, isPromptCancelled, wizardInputTheme, wizardSelectTheme} from '../../lib/prompt-utils.js'

/**
 * Wrap a prompt call with ESC back-navigation support.
 * If the user presses ESC, throws EscBackError so the wizard goes back one step.
 * If the user presses Ctrl+C, re-throws so the command exits.
 */
async function withEscBack<T>(
  esc: ReturnType<typeof createEscapeSignal>,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  try {
    return await fn(esc.signal)
  } catch (error) {
    if (isEscBack(error)) {
      esc.reset()
      throw new EscBackError()
    }

    if (isForceExit(error)) {
      throw error
    }

    throw error
  }
}

/**
 * Create the real wizard prompts backed by @inquirer/prompts.
 * Wires createEscapeSignal() for ESC back-navigation on every prompt.
 */
function createWizardPrompts(esc: ReturnType<typeof createEscapeSignal>): MemoryWizardPrompts {
  return {
    async configureBudget(): Promise<{globalMonthlyCents: number}> {
      const amount = await withEscBack(esc, (signal) => input({
        default: '50',
        message: 'Monthly budget cap in dollars:',
        theme: wizardInputTheme,
      }, {signal}))
      const cents = Math.round(Number.parseFloat(amount) * 100)

      return {globalMonthlyCents: cents}
    },

    async configureProvider(provider: DetectedProvider): Promise<Record<string, unknown>> {
      const config: Record<string, unknown> = {}

      switch (provider.id) {
        case 'gbrain': {
          config.repo_path = await withEscBack(esc, (signal) => input({
            message: 'GBrain repo path:',
            theme: wizardInputTheme,
          }, {signal}))

          break
        }

        case 'hindsight': {
          config.connection_string = await withEscBack(esc, (signal) => input({
            // eslint-disable-next-line no-template-curly-in-string -- literal ${VAR} placeholder for resolveEnvVars
            default: '${HINDSIGHT_DB_URL}',
            message: 'Hindsight connection string:',
            theme: wizardInputTheme,
          }, {signal}))

          break
        }

        case 'honcho': {
          config.api_key = await withEscBack(esc, (signal) => input({
            // eslint-disable-next-line no-template-curly-in-string -- literal ${VAR} placeholder for resolveEnvVars
            default: '${HONCHO_API_KEY}',
            message: 'Honcho API key (or env var reference):',
            theme: wizardInputTheme,
          }, {signal}))
          config.app_id = await withEscBack(esc, (signal) => input({
            message: 'Honcho app ID:',
            theme: wizardInputTheme,
          }, {signal}))

          break
        }

        case 'local-markdown': {
          const path = await withEscBack(esc, (signal) => input({
            default: provider.path,
            message: 'Markdown folder path:',
            theme: wizardInputTheme,
          }, {signal}))
          const name = await withEscBack(esc, (signal) => input({
            message: 'Human-readable name for this folder:',
            theme: wizardInputTheme,
          }, {signal}))
          config.folders = [{
            follow_wikilinks: true,
            name,
            path,
            read_only: true,
          }]

          break
        }

        case 'obsidian': {
          config.vault_path = await withEscBack(esc, (signal) => input({
            default: provider.path,
            message: 'Obsidian vault path:',
            theme: wizardInputTheme,
          }, {signal}))

          break
        }
      }

      return config
    },

    async confirmWrite(summary: string): Promise<boolean> {
      console.log('\n' + chalk.bold('Memory Swarm Configuration Summary:'))
      console.log(summary)
      console.log('')

      return withEscBack(esc, (signal) => confirm({
        default: true,
        message: 'Write to .brv/swarm/config.yaml?',
      }, {signal}))
    },

    async selectProviders(detected: DetectedProvider[]): Promise<string[]> {
      const choices = detected.map((p, index) => {
        const status = p.detected
          ? chalk.green('detected')
          : chalk.dim('not found')
        const detail = p.path ? ` — ${p.path}` : p.envVar ? ` (${p.envVar})` : ''
        const count = p.noteCount ? ` (${p.noteCount} files)` : ''

        return {
          checked: p.detected,
          disabled: p.id === 'byterover' ? '(always on)' : false,
          name: `${p.id}${detail}${count} [${status}]`,
          value: String(index),
        }
      })

      return withEscBack(esc, (signal) => checkbox({
        choices,
        message: 'Select providers to enable:',
        theme: wizardSelectTheme,
      }, {signal}))
    },
  }
}

export default class SwarmOnboard extends Command {
  public static description = 'Set up memory swarm with interactive onboarding wizard'
  public static examples = [
    '<%= config.bin %> swarm onboard',
  ]

  public async run(): Promise<void> {
    this.log(chalk.bold('\nMemory Swarm Onboarding'))
    this.log('Scanning for memory providers...\n')

    const esc = createEscapeSignal()

    try {
      // Step 1: Detect providers
      const detected = await detectProviders()

      // Step 2: Run wizard
      const prompts = createWizardPrompts(esc)
      const answers = await runMemoryWizard(prompts, detected)

      // Step 3: Scaffold config
      const {warnings, yaml: configYaml} = scaffoldConfig(answers)

      // Surface scaffolding warnings (e.g. duplicate vaults dropped)
      for (const warning of warnings) {
        this.log(chalk.yellow(`⚠ ${warning}`))
      }

      // Step 4: Write config file
      const configDir = join(process.cwd(), '.brv', 'swarm')
      if (!existsSync(configDir)) {
        mkdirSync(configDir, {recursive: true})
      }

      const configPath = join(configDir, 'config.yaml')
      writeFileSync(configPath, configYaml)
      this.log(chalk.green(`\n✓ Config written to ${configPath}`))

      // Step 5: Validate roundtrip
      const parsed = load(configYaml)
      const validation = safeValidateSwarmConfig(parsed)
      if (validation.success) {
        this.log(chalk.green('✓ Config validated successfully'))
      } else {
        this.log(chalk.yellow('⚠ Config validation warning — check the generated file.'))
      }

      // Step 6: Suggest next step
      this.log(`\nRun ${chalk.cyan('brv swarm status')} to verify provider health.`)
    } catch (error) {
      if (error instanceof WizardCancelledError) {
        this.log('\nWizard cancelled. No files were written.')

        return
      }

      if (isPromptCancelled(error)) {
        this.log('\nWizard cancelled.')

        return
      }

      throw error
    } finally {
      esc.cleanup()
    }
  }
}
