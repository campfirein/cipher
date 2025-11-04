import type {Hook} from '@oclif/core'

import chalk from 'chalk'

import {DOCS_URL} from '../../constants.js'

const hook: Hook<'init'> = async function (options): Promise<void> {
  // Detect root help commands only (not command-specific help)
  const isRootHelp =
    (options.id === undefined && options.argv.length === 0) || // bare `brv`
    (options.id === '--help' && options.argv.length === 0) || // `brv --help`
    (options.id === 'help' && options.argv.length === 0) // `brv help`

  if (isRootHelp) {
    const logo = [
      chalk.greenBright('  ____        _       ____                       '),
      chalk.greenBright(String.raw` | __ ) _   _| |_ ___|  _ \ _____   _____ _ __  `),
      chalk.green(String.raw` |  _ \| | | | __/ _ \ |_) / _ \ \ / / _ \ '__| `),
      chalk.greenBright(String.raw` | |_) | |_| | ||  __/  _ < (_) \ V /  __/ |    `),
      chalk.cyan(String.raw` |____/ \__, |\__\___|_| \_\___/ \_/ \___|_|    `),
      chalk.cyan('        |___/                                  '),
    ].join('\n')

    const onboardingText = [
      'ByteRover CLI quick start:',
      '',
      '  1. Authenticate with ByteRover:',
      '     brv login',
      '  2. Link your workspace:',
      '     brv init',
      '',
      'After setup, run `brv status` to confirm connection and explore commands like `brv retrieve` or `brv complete`.',
    ].join('\n')

    const docsLink = `For more information, run 'brv --help', 'brv [command] --help' or visit ${DOCS_URL}`

    this.log(`\n${logo}\n\n${onboardingText}\n\n${docsLink}\n\n`)
  }
}

export default hook
