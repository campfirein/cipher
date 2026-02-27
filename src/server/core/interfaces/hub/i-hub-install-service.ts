import type {AuthScheme} from '../../../../shared/transport/types/auth-scheme.js'
import type {HubEntryDTO} from '../../../../shared/transport/types/dto.js'

/**
 * Auth parameters for private registry downloads.
 */
export interface HubInstallAuthParams {
  authScheme?: AuthScheme
  authToken?: string
  headerName?: string
}

/**
 * Result of a hub install operation.
 */
export interface HubInstallResult {
  installedFiles: string[]
  installedPath: string
  message: string
}

/**
 * Parameters for installing a hub entry.
 */
export interface HubInstallParams {
  /** The target agent display name (required for skills). */
  agent?: string
  /** Optional auth parameters for private registry downloads. */
  auth?: HubInstallAuthParams
  /** The hub entry to install. */
  entry: HubEntryDTO
  /** The project root path. */
  projectPath: string
  /** Optional scope for skill installs ('global' or 'project'). Ignored for bundles. */
  scope?: 'global' | 'project'
}

/**
 * Interface for installing hub entries (skills and bundles).
 */
export interface IHubInstallService {
  /**
   * Installs a hub entry.
   * Skills are written to the target agent's skill directory.
   * Bundles are written to the context tree.
   */
  install(params: HubInstallParams): Promise<HubInstallResult>
}
