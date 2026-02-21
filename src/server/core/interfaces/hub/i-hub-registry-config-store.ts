import type {AuthScheme} from '../../../../shared/transport/types/auth-scheme.js'

/**
 * A configured private hub registry entry.
 */
export interface HubRegistryEntry {
  readonly authScheme?: AuthScheme
  readonly headerName?: string
  readonly name: string
  readonly url: string
}

/**
 * Interface for storing and retrieving private hub registry configurations.
 */
export interface IHubRegistryConfigStore {
  /**
   * Adds a registry. Throws if a registry with the same name already exists.
   */
  addRegistry(entry: HubRegistryEntry): Promise<void>

  /**
   * Returns all configured registries.
   */
  getRegistries(): Promise<HubRegistryEntry[]>

  /**
   * Removes a registry by name. No-op if the registry does not exist.
   */
  removeRegistry(name: string): Promise<void>
}
