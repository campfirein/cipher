#!/usr/bin/env node

process.env.BRV_ENV = 'production'

import {execute} from '@oclif/core'

await execute({dir: import.meta.url})
