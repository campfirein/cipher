import type {GlobalConfig} from '../domain/entities/global-config.js'

/**
 * Interface for storing and retrieving global ByteRover CLI configuration.
 * Implementations handle persistence of user-level config (e.g., ~/.config/brv/config.json).
 */
export interface IGlobalConfigStore {
  /**
   * Gets the existing device ID or creates a new one if not present.
   * This is the primary method for obtaining the device ID for tracking.
   *
   * @returns The device ID (existing or newly generated)
   */
  getOrCreateDeviceId: () => Promise<string>

  /**
   * Reads the global configuration from the user's config directory.
   *
   * @returns The configuration if found and valid, undefined otherwise
   */
  read: () => Promise<GlobalConfig | undefined>

  /**
   * Writes the global configuration to the user's config directory.
   * Creates the directory if it doesn't exist.
   *
   * @param config The configuration to write
   */
  write: (config: GlobalConfig) => Promise<void>
}
