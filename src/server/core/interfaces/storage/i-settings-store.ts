import type {SettingItem} from '../../domain/entities/settings.js'

/**
 * Persists and reads user-configurable operational settings.
 *
 * Errors:
 * - Unknown keys throw `UnknownSettingKeyError`.
 * - Invalid values (wrong type, out of range) throw `InvalidSettingValueError`.
 * Callers at the transport boundary map these to typed transport errors.
 */
export interface ISettingsStore {
  /** Returns the current value (or default if unset) for a single registered key. */
  get(key: string): Promise<SettingItem>

  /** Returns one item per registered key with its current and default values. */
  list(): Promise<readonly SettingItem[]>

  /** Removes any user override for `key`. The next read returns the default. */
  reset(key: string): Promise<void>

  /** Validates and persists an override for `key`. */
  set(key: string, value: unknown): Promise<void>
}
