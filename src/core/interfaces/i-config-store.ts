import type {BrConfig} from '../domain/entities/br-config.js'

/**
 * Interface for storing and retrieving ByteRover CLI configuration.
 * Implementations handle persistence of .br/config.json files.
 */
export interface IConfigStore {
  /**
   * Checks if a configuration file exists in the .br directory.
   * @param directory The project directory to check (defaults to current working directory).
   * @returns True if .br/config.json exists, false otherwise.
   */
  exists: (directory?: string) => Promise<boolean>

  /**
   * Reads the configuration from the .br directory.
   * @param directory The project directory containing .br folder (defaults to current working directory)
   * @returns The configuration if found, undefined otherwise
   */
  read: (directory?: string) => Promise<BrConfig | undefined>

  /**
   * Writes the configuration to the .br directory.
   * @param config The configuration to write.
   * @param directory The project directory to create .br folder in (defaults to current working directory)
   * @returns
   */
  write: (config: BrConfig, directory?: string) => Promise<void>
}
