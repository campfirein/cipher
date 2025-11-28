import type {Hook} from '@oclif/core'

import chalk from 'chalk'

import {DOCS_URL} from '../../constants.js'

/**
 * Validates Node.js version compatibility
 * @returns Error message if incompatible, warning message if untested, null if compatible
 */
function checkNodeVersion(): null | {message: string; type: 'error' | 'warning'} {
  const nodeVersion = process.version
  const versionMatch = nodeVersion.match(/^v(\d+)\.(\d+)\.(\d+)/)

  if (!versionMatch) {
    return {
      message: `Unable to determine Node.js version. Current version: ${nodeVersion}`,
      type: 'warning',
    }
  }

  const [, major, minor] = versionMatch
  const majorVersion = Number.parseInt(major, 10)
  const minorVersion = Number.parseInt(minor, 10)

  // Minimum supported version: Node 18
  if (majorVersion < 18) {
    return {
      message:
        `Node.js ${majorVersion}.${minorVersion} is not supported.\n` +
        'ByteRover CLI requires Node.js 18 or higher.\n' +
        `Current version: ${nodeVersion}\n\n` +
        'Please upgrade Node.js:\n' +
        '  - Using nvm: nvm install 22 && nvm use 22\n' +
        '  - Download from: https://nodejs.org/',
      type: 'error',
    }
  }

  // Recommended versions: Node 18, 20, 22
  // Node 24+ may have compatibility issues with native modules (better-sqlite3, grpc)
  if (majorVersion >= 24) {
    return {
      message:
        `Node.js ${majorVersion}.${minorVersion} has not been fully tested with ByteRover CLI.\n` +
        `Current version: ${nodeVersion}\n` +
        'Recommended versions: Node.js 18.x, 20.x, or 22.x (LTS)\n\n' +
        'Some native dependencies (sqlite, grpc) may not work correctly.\n' +
        'If you encounter errors, please switch to a recommended version:\n' +
        '  - Using nvm: nvm install 22 && nvm use 22',
      type: 'warning',
    }
  }

  // All checks passed
  return null
}

const hook: Hook<'init'> = async function (options): Promise<void> {
  // Check Node.js version compatibility first
  const versionCheck = checkNodeVersion()
  if (versionCheck) {
    if (versionCheck.type === 'error') {
      // Critical error - incompatible Node version
      // Use process.stderr to show clean error without stack trace
      process.stderr.write('\n')
      process.stderr.write(chalk.red('❌ Incompatible Node.js version\n\n'))
      process.stderr.write(versionCheck.message)
      process.stderr.write('\n\n')
      // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
      process.exit(1)
    } else if (versionCheck.type === 'warning') {
      // Warning - untested version, but allow to continue
      // Use process.stderr to show clean warning without stack trace
      process.stderr.write('\n')
      process.stderr.write(chalk.yellow('⚠️  Node.js version warning\n\n'))
      process.stderr.write(chalk.yellow(versionCheck.message))
      process.stderr.write('\n\n')
    }
  }

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
      'After setup, run `brv status` to confirm connection and explore commands like `brv complete` or `brv push`.',
    ].join('\n')

    const docsLink = `For more information, run 'brv --help', 'brv [command] --help' or visit ${DOCS_URL}`

    this.log(`\n${logo}\n\n${onboardingText}\n\n${docsLink}\n\n`)
  }
}

export default hook
