import type {Hook} from '@oclif/core'

import {execSync} from 'node:child_process'

/**
 * Runs after a successful tarball update (`brv update`).
 *
 * Kills old daemon/agent processes so the next `brv` command loads the new version.
 * Skips for background auto-updates: @oclif/plugin-update's init hook spawns
 * `brv update --autoupdate` with BRV_SKIP_ANALYTICS=1 in the env. Manual
 * `brv update` runs in the user's shell where this env var is not set.
 */
const hook: Hook<'update'> = async function () {
  if (process.env.BRV_SKIP_ANALYTICS === '1') return

  this.log('Restarting ByteRover...')
  try {
    execSync('brv restart', {stdio: 'inherit'})
  } catch {
    // best-effort — update already succeeded, process may have been killed by restart
  }
}

export default hook
