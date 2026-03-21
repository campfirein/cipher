import type {Hook} from '@oclif/core'

import {execSync} from 'node:child_process'

export type RestartAfterUpdateDeps = {
  argv: string[]
  commandId: string | undefined
  execSyncFn: typeof execSync
  log: (msg: string) => void
}

/**
 * Restart daemon/agent processes after a manual `brv update`.
 *
 * Fires after every command via the oclif postrun hook; early-returns for
 * anything other than `brv update`.
 *
 * Skips background auto-updates: @oclif/plugin-update passes `--autoupdate`
 * when spawning `brv update` in the background. Manual `brv update` runs
 * in the user's shell without that flag.
 */
export async function handleRestartAfterUpdate(deps: RestartAfterUpdateDeps): Promise<void> {
  if (deps.commandId !== 'update') return
  if (deps.argv.includes('--autoupdate')) return

  deps.log('Restarting ByteRover...')
  try {
    deps.execSyncFn('brv restart', {stdio: 'inherit'})
  } catch {
    // best-effort — update already succeeded, process may have been killed by restart
  }
}

const hook: Hook<'postrun'> = async function (opts) {
  await handleRestartAfterUpdate({
    argv: opts.argv,
    commandId: opts.Command.id,
    execSyncFn: execSync,
    log: this.log.bind(this),
  })
}

export default hook
