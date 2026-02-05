import type {Hook} from '@oclif/core'

import {confirm} from '@inquirer/prompts'
import {execSync} from 'node:child_process'
import updateNotifier from 'update-notifier'

/**
 * Check interval for update notifications (1 hour)
 */
export const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60

/**
 * Narrowed notifier type for dependency injection
 */
export type NarrowedUpdateNotifier = {
  notify: (options: {defer: boolean; message: string}) => void
  update?: {current: string; latest: string}
}

/**
 * Dependencies that can be injected for testing
 */
export type UpdateNotifierDeps = {
  confirmPrompt: (options: {default: boolean; message: string}) => Promise<boolean>
  execSyncFn: (command: string, options: {stdio: 'inherit'}) => void
  exitFn: (code: number) => never
  isTTY: boolean
  log: (message: string) => void
  notifier: NarrowedUpdateNotifier
}

/**
 * Core update notification logic, extracted for testability
 */
export async function handleUpdateNotification(deps: UpdateNotifierDeps): Promise<void> {
  const {confirmPrompt, execSyncFn, exitFn, isTTY, log, notifier} = deps

  if (!notifier.update || !isTTY) {
    return
  }

  const {current, latest} = notifier.update

  // Skip if already on latest version (handles stale cache after update)
  if (current === latest) {
    return
  }

  const shouldUpdate = await confirmPrompt({
    default: true,
    message: `Update available: ${current} → ${latest}. Would you like to update now?`,
  })

  if (shouldUpdate) {
    log('Updating byterover-cli...')
    try {
      execSyncFn('npm update -g byterover-cli', {stdio: 'inherit'})
      log('')
      log(`✓ Successfully updated to ${latest}`)
      log('')
      log(`The update will take effect on next launch. Run 'brv' when ready.`)
      exitFn(0)
    } catch {
      log('⚠️  Automatic update failed. Please run manually: npm update -g byterover-cli')
    }
  }
}

const hook: Hook<'init'> = async function (): Promise<void> {
  const pkgInfo = {name: this.config.name, version: this.config.version}
  const notifier = updateNotifier({pkg: pkgInfo, updateCheckInterval: UPDATE_CHECK_INTERVAL_MS})

  await handleUpdateNotification({
    confirmPrompt: confirm,
    execSyncFn: execSync,
    exitFn: process.exit,
    isTTY: process.stdout.isTTY ?? false,
    log: this.log.bind(this),
    notifier,
  })
}

export default hook
