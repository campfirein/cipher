#!/usr/bin/env node

import {execute} from '@oclif/core'
import {config as loadEnv} from 'dotenv'
import {resolve} from 'node:path'

process.env.BRV_ENV = 'production'

// eslint-disable-next-line n/no-unsupported-features/node-builtins
const root = resolve(import.meta.dirname, '..')
loadEnv({path: resolve(root, '.env.production'), quiet: true})


// Inject default command 'main' (represents logic of a single 'brv' run) when no args provided
// process.argv = ['node', 'brv', ...userArgs]
const userArgs = process.argv.slice(2)
if (userArgs.length === 0) {
  process.argv.push('main')
}

await execute({ dir: import.meta.url })
