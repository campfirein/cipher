#!/usr/bin/env -S node --loader ts-node/esm --no-warnings=ExperimentalWarning

process.env.BRV_ENV = 'development'

import {execute} from '@oclif/core'

// Inject default command 'main' (represents logic of a single 'brv' run) when no args provided
// process.argv = ['node', 'bin/dev.js', ...userArgs]
const userArgs = process.argv.slice(2)
if (userArgs.length === 0) {
  process.argv.push('main')
}

await execute({development: true, dir: import.meta.url})
