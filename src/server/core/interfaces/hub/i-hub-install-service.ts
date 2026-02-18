import type {HubEntryDTO} from '../../../../shared/transport/types/dto.js'

/**
 * Result of a hub install operation.
 */
export interface HubInstallResult {
  installedFiles: string[]
  message: string
}

/**
 * Interface for installing hub entries (skills and bundles).
 */
export interface IHubInstallService {
  /**
   * Installs a hub entry.
   * Skills are written to the target agent's skill directory.
   * Bundles are written to the context tree.
   *
   * @param entry The hub entry to install.
   * @param projectPath The project root path.
   * @param agent The target agent display name (required for skills).
   * @returns A promise resolving to the install result.
   */
  install(entry: HubEntryDTO, projectPath: string, agent?: string): Promise<HubInstallResult>
}
