import type {Hook} from '@oclif/core'

import {confirm} from '@inquirer/prompts'
import {execSync, spawn} from 'node:child_process'
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
  isNpmGlobalInstalled: boolean
  isTTY: boolean
  log: (message: string) => void
  notifier: NarrowedUpdateNotifier
  spawnRestartFn: () => {unref(): void}
}

/**
 * Check whether byterover-cli is installed as a npm global package.
 * @param execSyncFn
 * @returns false for other installation methods.
 */
export const isNpmGlobalInstall = (execSyncFn: typeof execSync): boolean => {
  try {
    execSyncFn('npm list -g byterover-cli --depth=0', {stdio: 'ignore'})
    return true
  } catch {
    return false
  }
}

/**
 * Core update notification logic, extracted for testability
 */
export async function handleUpdateNotification(deps: UpdateNotifierDeps): Promise<void> {
  const {confirmPrompt, execSyncFn, exitFn, isNpmGlobalInstalled, isTTY, log, notifier} = deps

  if (!isNpmGlobalInstalled || !notifier.update || !isTTY) {
    return
  }

  const {current, latest} = notifier.update

  // Skip if already on latest version (handles stale cache after update)
  if (current === latest) {
    return
  }

  const shouldUpdate = await confirmPrompt({
    default: true,
    message: `Update available: ${current} → ${latest}. Update now? (active sessions will be restarted)`,
  })

  if (shouldUpdate) {
    log('Updating byterover-cli...')
    try {
      execSyncFn('npm update -g byterover-cli', {stdio: 'inherit'})
      log('')
      log(`✓ Updated to ${latest}.`)
      log('')
      try {
        const child = deps.spawnRestartFn()
        child.unref()
        log('Restarting ByteRover in the background. Please wait a few seconds before running brv again.')
      } catch {
        log('Failed to restart ByteRover. Please restart it manually by running `brv restart`.')
      }

      exitFn(0)
    } catch {
      log('⚠️  Automatic update failed. Please run manually: npm update -g byterover-cli')
    }
  }
}

const hook: Hook<'init'> = async function (): Promise<void> {
  const pkgInfo = {name: this.config.name, version: this.config.version}
  const notifier = updateNotifier({pkg: pkgInfo, updateCheckInterval: UPDATE_CHECK_INTERVAL_MS})
  const isNpmGlobalInstalled = isNpmGlobalInstall(execSync)

  await handleUpdateNotification({
    confirmPrompt: confirm,
    execSyncFn: execSync,
    exitFn: process.exit,
    isNpmGlobalInstalled,
    isTTY: process.stdout.isTTY ?? false,
    log: this.log.bind(this),
    notifier,
    spawnRestartFn: () =>
      spawn('brv restart', {
        detached: true,
        shell: true,
        stdio: 'ignore',
        windowsHide: true,
      }),
  })
}

export default hook
