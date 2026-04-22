/**
 * AutoHarness V2 — shared CLI helpers.
 *
 * Used by `brv harness status` / `inspect` / `use` / `diff` / `baseline`
 * to stand up an `IHarnessStore` against the same on-disk state the
 * daemon writes to, without booting the full agent pipeline.
 *
 * Design: stateless read helpers. No daemon roundtrip, no agent config
 * validation. CLI commands call `openHarnessStoreForProject` to get a
 * live store, `readHarnessFeatureConfig` for the enabled/autoLearn
 * flags, and `closeHarnessStore` on their way out.
 */

import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {IHarnessStore} from '../../agent/core/interfaces/i-harness-store.js'

import {NoOpLogger} from '../../agent/core/interfaces/i-logger.js'
import {HarnessStore} from '../../agent/infra/harness/harness-store.js'
import {FileKeyStorage} from '../../agent/infra/storage/file-key-storage.js'
import {BRV_DIR, GLOBAL_PROJECTS_DIR, PROJECT_CONFIG_FILE} from '../../server/constants.js'
import {getGlobalDataDir} from '../../server/utils/global-data-path.js'
import {resolvePath, sanitizeProjectPath} from '../../server/utils/path-utils.js'

/**
 * Public feature-flag view for `brv harness status` and friends.
 *
 * `enabled` / `autoLearn` mirror `ValidatedHarnessConfig` but are
 * decoupled from the agent schema so the CLI doesn't pull in the full
 * agent-schemas surface for a flag read.
 */
export interface HarnessFeatureConfig {
  readonly autoLearn: boolean
  readonly enabled: boolean
}

export interface OpenedHarnessStore {
  readonly close: () => void
  /**
   * Absolute project path — used as the `projectId` partition key in
   * the store (mirrors the daemon's `AgentLLMService` convention).
   */
  readonly projectId: string
  readonly store: IHarnessStore
}

const HARNESS_CONFIG_DEFAULTS: HarnessFeatureConfig = {
  autoLearn: true,
  enabled: false,
}

/**
 * Open a live `HarnessStore` rooted at the same XDG location the
 * daemon writes to.
 *
 * Uses the same `sanitizeProjectPath` rule as `ProjectRegistry.register`
 * so the CLI reads the exact directory the daemon wrote. No registry
 * mutation — running `brv harness status` on an unknown project must
 * not create sessions directories or persist a registry entry.
 *
 * Returns `undefined` when the storage directory doesn't exist yet
 * (project has never been touched by the daemon). Callers interpret
 * that as "no stored harness state" and produce the empty shape.
 */
export async function openHarnessStoreForProject(
  projectRoot: string,
): Promise<OpenedHarnessStore | undefined> {
  const resolvedRoot = resolvePath(projectRoot)
  const sanitized = sanitizeProjectPath(resolvedRoot)
  const storagePath = join(getGlobalDataDir(), GLOBAL_PROJECTS_DIR, sanitized)

  if (!existsSync(storagePath)) {
    return undefined
  }

  const keyStorage = new FileKeyStorage({storageDir: storagePath})
  await keyStorage.initialize()
  const store = new HarnessStore(keyStorage, new NoOpLogger())

  return {
    close: () => keyStorage.close(),
    projectId: resolvedRoot,
    store,
  }
}

/**
 * Read the harness feature-flags off the project's
 * `.brv/config.json`, under a top-level `harness` key:
 *
 * ```json
 * { "createdAt": "...", "harness": { "enabled": true, "autoLearn": true } }
 * ```
 *
 * Missing file / missing key / malformed JSON all degrade to the
 * defaults (`enabled: false, autoLearn: true`) — read-only CLI
 * commands must never refuse to run because the config is absent.
 *
 * Kept outside of `BrvConfig`'s typed surface because the daemon
 * config plumbing for harness lives in a follow-up PR — the CLI
 * ships first to unblock 7.2/7.4 which also need the flags.
 */
export async function readHarnessFeatureConfig(
  projectRoot: string,
): Promise<HarnessFeatureConfig> {
  const configPath = join(projectRoot, BRV_DIR, PROJECT_CONFIG_FILE)
  if (!existsSync(configPath)) return HARNESS_CONFIG_DEFAULTS

  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch {
    return HARNESS_CONFIG_DEFAULTS
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return HARNESS_CONFIG_DEFAULTS
  }

  if (typeof parsed !== 'object' || parsed === null) return HARNESS_CONFIG_DEFAULTS
  const harnessField = (parsed as Record<string, unknown>).harness
  if (typeof harnessField !== 'object' || harnessField === null) return HARNESS_CONFIG_DEFAULTS

  const h = harnessField as Record<string, unknown>
  return {
    autoLearn: typeof h.autoLearn === 'boolean' ? h.autoLearn : HARNESS_CONFIG_DEFAULTS.autoLearn,
    enabled: typeof h.enabled === 'boolean' ? h.enabled : HARNESS_CONFIG_DEFAULTS.enabled,
  }
}
