import type {Hook} from '@oclif/core'

import {execSync} from 'node:child_process'

import {isNpmGlobalInstall} from './update-notifier.js'

const hook: Hook<'init'> = async function (opts): Promise<void> {
  const isNpmGlobalInstalled = isNpmGlobalInstall(execSync)

  if (opts.id === 'update' && isNpmGlobalInstalled) {
    this.error('brv was installed via npm. Use `npm update -g byterover-cli` to update.', {exit: 1})
  }
}

export default hook
