import type {Hook} from '@oclif/core'

import {access, mkdir, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import type {IProjectConfigStore} from '../../../server/core/interfaces/storage/i-project-config-store.js'

import {BRV_CONFIG_VERSION} from '../../../server/constants.js'
import {type AutoInitDeps, ensureProjectInitialized} from '../../../server/infra/config/auto-init.js'
import {ProjectConfigStore} from '../../../server/infra/config/file-config-store.js'
import {ensureCurateViewPatched} from '../../../server/infra/connectors/shared/rule-segment-patcher.js'
import {FileContextTreeService} from '../../../server/infra/context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../../../server/infra/context-tree/file-context-tree-snapshot-service.js'
import {type ProjectResolution, resolveProject} from '../../../server/infra/project/resolve-project.js'
import {syncConfigToXdg} from '../../../server/utils/config-xdg-sync.js'
import {getProjectDataDir} from '../../../server/utils/path-utils.js'

/**
 * Commands that should skip auto-init and config version validation.
 */
export const SKIP_COMMANDS = new Set<string>(['--help', 'help', 'link', 'link-knowledge', 'list-knowledge-links', 'login', 'logout', 'unlink', 'unlink-knowledge'])

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

export interface ValidateBrvConfigVersionOptions {
  autoInitDeps?: AutoInitDeps
  commandId: string
  configStore: IProjectConfigStore
  patchMarkerDeps?: PatchMarkerDeps
  resolver?: () => null | ProjectResolution
}

/**
 * Core validation logic extracted for testability.
 * Auto-initializes .brv/ if it doesn't exist, then migrates config version if needed.
 * Also ensures connector files are patched with `brv curate view` docs (once per project).
 */
export const validateBrvConfigVersion = async (options: ValidateBrvConfigVersionOptions): Promise<void> => {
  const {autoInitDeps, commandId, configStore, patchMarkerDeps, resolver} = options
  // Skip for commands that don't need config
  if (SKIP_COMMANDS.has(commandId)) {
    return
  }

  // Resolve project via canonical resolver first.
  // If a project is found (direct, linked, or walked-up), use its projectRoot.
  // Only auto-init when resolution is null (no project found at all).
  const resolve = resolver ?? resolveProject
  const resolution = resolve()
  const projectRoot = resolution?.projectRoot

  if (!projectRoot) {
    // No project found — auto-init at cwd
    const exists = await configStore.exists()
    if (!exists) {
      const deps = autoInitDeps ?? {
        contextTreeService: new FileContextTreeService(),
        contextTreeSnapshotService: new FileContextTreeSnapshotService(),
        projectConfigStore: configStore,
      }
      await ensureProjectInitialized(deps)
    }

    return
  }

  // Read existing config at the resolved project root
  const config = await configStore.read(projectRoot)
  if (!config) return

  const cwd = projectRoot

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
    await configStore.write(updated, projectRoot)
    await syncConfigToXdg(updated, cwd)
  }
}

/**
 * Prerun hook that auto-initializes .brv/ if missing, then validates config version.
 */
const hook: Hook<'prerun'> = async function (options): Promise<void> {
  await validateBrvConfigVersion({commandId: options.Command.id, configStore: new ProjectConfigStore()})
}

export default hook
