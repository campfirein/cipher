import type {Hook} from '@oclif/core'

import {execSync} from 'node:child_process'

import {isNpmGlobalInstall} from './update-notifier.js'

export type BlockCommandUpdateNpmDeps = {
  commandId: string | undefined
  errorFn: (message: string, options: {exit: number}) => void
  isNpmGlobalInstalled: boolean
}

export function handleBlockCommandUpdateNpm(deps: BlockCommandUpdateNpmDeps): void {
  if (deps.commandId === 'update' && deps.isNpmGlobalInstalled) {
    deps.errorFn('brv was installed via npm. Use `npm update -g byterover-cli` to update.', {exit: 1})
  }
}

const hook: Hook<'init'> = async function (opts): Promise<void> {
  handleBlockCommandUpdateNpm({
    commandId: opts.id,
    errorFn: this.error.bind(this),
    isNpmGlobalInstalled: isNpmGlobalInstall(execSync),
  })
}

export default hook
