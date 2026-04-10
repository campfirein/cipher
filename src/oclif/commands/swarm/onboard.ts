import {checkbox, confirm, input, select} from '@inquirer/prompts'
import {Args, Command} from '@oclif/core'
import chalk from 'chalk'
import fs from 'node:fs/promises'
import path from 'node:path'

import type {WizardPrompts} from '../../../agent/infra/swarm/swarm-wizard.js'

import {SwarmLoader} from '../../../agent/infra/swarm/swarm-loader.js'
import {scaffoldSwarm} from '../../../agent/infra/swarm/swarm-scaffolder.js'
import {runWizard} from '../../../agent/infra/swarm/swarm-wizard.js'
import {createEscapeSignal, isPromptCancelled, wizardInputTheme, wizardSelectTheme} from '../../lib/prompt-utils.js'
import {createSpinner} from '../../lib/spinner.js'

export default class SwarmOnboard extends Command {
  public static args = {
    dir: Args.string({
      default: '.',
      description: 'Directory to create swarm spec in (default: current directory)',
      required: false,
    }),
  }
  public static description = 'Scaffold a new swarm specification interactively'
  public static examples = [
    '<%= config.bin %> swarm onboard',
    '<%= config.bin %> swarm onboard ./my-swarm',
  ]

  protected async confirmLoadExisting(): Promise<boolean> {
    return confirm({message: 'Load existing swarm spec instead?'})
  }

  protected createLoader(): SwarmLoader {
    return new SwarmLoader()
  }

  protected createWizardPrompts(): WizardPrompts {
    const esc = createEscapeSignal()

    const resetOnCancel = (error: unknown) => {
      if (isPromptCancelled(error)) esc.reset()
      throw error
    }

    const prompts: WizardPrompts & {cleanup?: () => void} = {
      async checkbox(message, choices) {
        return checkbox({choices: choices.map((c) => ({name: c.name, value: c.value})), message, theme: wizardSelectTheme}, {signal: esc.signal}).catch(resetOnCancel)
      },
      cleanup: () => esc.cleanup(),
      async confirm(message) {
        return confirm({message}, {signal: esc.signal}).catch(resetOnCancel)
      },
      async input(message, opts) {
        return input({default: opts?.default, message, theme: wizardInputTheme, validate: opts?.validate}, {signal: esc.signal}).catch(resetOnCancel)
      },
      async select(message, choices) {
        return select({choices: choices.map((c) => ({name: c.name, value: c.value})), message, theme: wizardSelectTheme}, {signal: esc.signal}).catch(resetOnCancel)
      },
    }

    return prompts
  }

  public async run(): Promise<void> {
    const {args} = await this.parse(SwarmOnboard)
    const targetDir = path.resolve(args.dir ?? '.')

    // Check for existing spec
    if (await this.swarmSpecExists(targetDir)) {
      this.log(`Found existing SWARM.md in ${targetDir}`)
      try {
        const shouldLoad = await this.confirmLoadExisting()
        if (shouldLoad) {
          await this.config.runCommand('swarm:load', [targetDir])

          return
        }
      } catch (error) {
        if (isPromptCancelled(error)) return
        throw error
      }

      this.log('Aborted. Use "brv swarm load" to validate the existing spec.')

      return
    }

    // Run wizard
    const prompts = this.createWizardPrompts()
    const result = await runWizard(prompts)

    // Cleanup esc listener
    if ('cleanup' in prompts && typeof prompts.cleanup === 'function') {
      ;(prompts as {cleanup: () => void}).cleanup()
    }

    if (!result) {
      return
    }

    // Generate files
    const files = scaffoldSwarm(result)

    // Write to disk
    await this.writeFiles(targetDir, files)

    this.log(`\nCreated swarm spec in ${targetDir}:`)
    for (const filePath of Object.keys(files).sort()) {
      this.log(`  ${filePath}`)
    }

    // Validate
    const spinner = createSpinner('Validating...')
    try {
      const loaded = await this.createLoader().load(targetDir)
      spinner.clear()

      for (const w of loaded.warnings) {
        this.log(chalk.yellow(`Warning: ${w}`))
      }

      this.log(chalk.green(`\nSwarm "${result.name}" scaffolded successfully.`))
    } catch (error) {
      spinner.clear()
      this.log(chalk.red(`\nValidation failed: ${error instanceof Error ? error.message : 'Unknown error'}`))
      this.log('Files have been left in place for debugging.')
      this.exit(1)
    }
  }

  protected async swarmSpecExists(dir: string): Promise<boolean> {
    try {
      await fs.access(path.join(dir, 'SWARM.md'))

      return true
    } catch {
      return false
    }
  }

  protected async writeFiles(baseDir: string, files: Record<string, string>): Promise<void> {
    const sorted = Object.entries(files).sort(([a], [b]) => a.localeCompare(b))
    await Promise.all(
      sorted.map(async ([relPath, content]) => {
        const fullPath = path.join(baseDir, relPath)
        await fs.mkdir(path.dirname(fullPath), {recursive: true})
        await fs.writeFile(fullPath, content, 'utf8')
      }),
    )
  }
}
