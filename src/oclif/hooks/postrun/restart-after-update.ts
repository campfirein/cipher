import type {Hook} from '@oclif/core'

import {spawn} from 'node:child_process'

export type RestartAfterUpdateDeps = {
  argv: string[]
  commandId: string | undefined
  log: (msg: string) => void
  spawnRestartFn: () => {unref(): void}
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
    const child = deps.spawnRestartFn()
    child.unref()
  } catch {
    deps.log('Failed to restart ByteRover. Please restart it manually by running `brv restart`.')
    // best-effort — update already succeeded
  }

  deps.log('ByteRover restarted successfully.')
}

const hook: Hook<'postrun'> = async function (opts) {
  await handleRestartAfterUpdate({
    argv: opts.argv,
    commandId: opts.Command.id,
    log: this.log.bind(this),
    spawnRestartFn: () =>
      spawn('brv', ['restart'], {
        detached: true,
        shell: true,
        stdio: 'ignore',
      }),
  })
}

export default hook
