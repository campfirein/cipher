#!/usr/bin/env node

process.env.BRV_ENV = 'production'

import {execute} from '@oclif/core'

// Inject default command 'main' (represents logic of a single 'brv' run) when no args provided
// process.argv = ['node', 'brv', ...userArgs]
const userArgs = process.argv.slice(2)
if (userArgs.length === 0) {
  process.argv.push('main')
}

await execute({dir: import.meta.url})
