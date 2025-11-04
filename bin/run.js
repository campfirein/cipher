#!/usr/bin/env node

process.env.BRV_ENV = 'development'

import {execute} from '@oclif/core'

await execute({dir: import.meta.url})
