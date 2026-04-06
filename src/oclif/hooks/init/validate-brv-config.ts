import type {Hook} from '@oclif/core'

import {access, mkdir, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import type {IProjectConfigStore} from '../../../server/core/interfaces/storage/i-project-config-store.js'

import {BRV_CONFIG_VERSION} from '../../../server/constants.js'
import {ProjectConfigStore} from '../../../server/infra/config/file-config-store.js'
import {ensureCurateViewPatched} from '../../../server/infra/connectors/shared/rule-segment-patcher.js'
import {syncConfigToXdg} from '../../../server/utils/config-xdg-sync.js'
import {getProjectDataDir} from '../../../server/utils/path-utils.js'

/**
 * Commands that should skip auto-init and config version validation.
 */
export const SKIP_COMMANDS = new Set<string>([
  '--help',
  'help',
  'login',
  'logout',
  'main',
  'restart',
  'vc:clone',
  'vc:init',
])

export const isVcHelpRequest = (commandId: string | undefined, argv: string[]): boolean =>
  commandId === 'vc' && (argv.includes('--help') || argv.includes('-h'))

/**
 * Dependencies for the curate-view patch marker, injected for testability.
 * The marker file lives in the XDG/global data dir scoped to the current project,
 * keeping internal patch bookkeeping out of the user-facing .brv/config.json.
 */
export type PatchMarkerDeps = {
  isPatched(): Promise<boolean>
  markPatched(): Promise<void>
  patchFn?: (cwd: string) => Promise<void>
}

const getCurateViewMarkerPath = (cwd: string): string => join(getProjectDataDir(cwd), 'patches', 'curate-view.done')

const defaultPatchMarkerDeps = (cwd: string): PatchMarkerDeps => ({
  async isPatched() {
    try {
      await access(getCurateViewMarkerPath(cwd))
      return true
    } catch {
      return false
    }
  },
  async markPatched() {
    const markerPath = getCurateViewMarkerPath(cwd)
    await mkdir(dirname(markerPath), {recursive: true})
    await writeFile(markerPath, '')
  },
})

/**
 * Core validation logic extracted for testability.
 * Throws if .brv/ doesn't exist (user must run `brv init`), then migrates config version if needed.
 * Also ensures connector files are patched with `brv curate view` docs (once per project).
 *
 * @param commandId - The command being executed
 * @param configStore - The config store to use for reading config
 * @param patchMarkerDeps - Dependencies for the curate-view patch marker (optional, for testing)
 */
export const validateBrvConfigVersion = async (
  commandId: string,
  configStore: IProjectConfigStore,
  patchMarkerDeps?: PatchMarkerDeps,
): Promise<void> => {
  // Skip for commands that don't need config
  if (SKIP_COMMANDS.has(commandId)) {
    return
  }

  const exists = await configStore.exists()
  if (!exists) {
    const message = commandId.startsWith('vc:')
      ? 'ByteRover version control not initialized. Run brv vc init first.'
      : 'fatal: not a brv project (or any of the parent directories): .brv'
    throw new Error(message)
  }

  const config = await configStore.read()
  if (!config) {
    throw new Error('fatal: corrupt or unreadable config: .brv/config.json')
  }

  // ProjectConfigStore checks .brv/ at process.cwd() directly (no walk-up),
  // so configStore.exists() returning true means process.cwd() IS the project root.
  const cwd = process.cwd()

  // Gate the connector-file patch behind a per-project marker file in the XDG data dir.
  // This keeps internal bookkeeping out of the user-facing .brv/config.json.
  const marker = patchMarkerDeps ?? defaultPatchMarkerDeps(cwd)
  const alreadyPatched = await marker.isPatched()
  if (!alreadyPatched) {
    const patchFn = patchMarkerDeps?.patchFn ?? ensureCurateViewPatched
    await patchFn(cwd).catch(() => {})
    await marker.markPatched().catch(() => {})
  }

  if (config.version !== BRV_CONFIG_VERSION) {
    const updated = config.withVersion(BRV_CONFIG_VERSION)
    await configStore.write(updated)
    await syncConfigToXdg(updated, cwd)
  }
}

/**
 * Init hook that ensures .brv/ exists and validates config version.
 * Runs once during CLI bootstrap — does NOT re-fire for runCommand() calls,
 * so commands like `init` can safely delegate to sub-commands.
 */
const hook: Hook<'init'> = async function (options): Promise<void> {
  if (isVcHelpRequest(options.id, options.argv)) {
    return
  }

  try {
    await validateBrvConfigVersion(options.id ?? '', new ProjectConfigStore())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(1)
  }
}

export default hook
