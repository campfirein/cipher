#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning

process.env.BR_ENV = 'development'

import {execute} from '@oclif/core'

await execute({development: true, dir: import.meta.url})
