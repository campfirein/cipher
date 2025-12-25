import type {InstanceInfo} from '../../domain/instance/types.js'

/**
 * Result of instance discovery.
 *
 * - no_instance: No .brv/ directory found in tree
 * - instance_crashed: Found instance.json but pid is dead
 */
export type DiscoveryResult =
  | {found: false; reason: 'instance_crashed' | 'no_instance'}
  | {found: true; instance: InstanceInfo; projectRoot: string}

/**
 * Interface for discovering running instances via walk-up directory search.
 *
 * Architecture notes (Section 5 - Transport Discovery):
 * Walk up directory tree to find .brv/instance.json, verify pid alive.
 */
export interface IInstanceDiscovery {
  /**
   * Discovers a running instance starting from the given directory.
   *
   * Walk-up algorithm:
   * 1. Start from `fromDir`
   * 2. Check if .brv/instance.json exists
   * 3. If yes, verify pid is alive
   * 4. If no, walk up to parent directory
   * 5. Repeat until root or found
   *
   * @param fromDir - Starting directory (usually cwd)
   * @returns DiscoveryResult with instance info and project root if found
   */
  discover: (fromDir: string) => Promise<DiscoveryResult>

  /**
   * Finds the project root by walking up from a directory.
   * Returns the directory containing .brv/ or undefined if not found.
   *
   * @param fromDir - Starting directory
   * @returns Project root path or undefined
   */
  findProjectRoot: (fromDir: string) => Promise<string | undefined>
}
