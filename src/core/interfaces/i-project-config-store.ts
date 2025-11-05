import type {BrvConfig} from '../domain/entities/brv-config.js'

/**
 * Interface for storing and retrieving ByteRover CLI configuration.
 * Implementations handle persistence of .brv/config.json files.
 */
export interface IProjectConfigStore {
  /**
   * Checks if a configuration file exists in the .brv directory.
   * @param directory The project directory to check (defaults to current working directory).
   * @returns True if .brv/config.json exists, false otherwise.
   */
  exists: (directory?: string) => Promise<boolean>

  /**
   * Reads the configuration from the .brv directory.
   * @param directory The project directory containing .brv folder (defaults to current working directory)
   * @returns The configuration if found, undefined otherwise
   */
  read: (directory?: string) => Promise<BrvConfig | undefined>

  /**
   * Writes the configuration to the .brv directory.
   * @param config The configuration to write.
   * @param directory The project directory to create .brv folder in (defaults to current working directory)
   * @returns
   */
  write: (config: BrvConfig, directory?: string) => Promise<void>
}
