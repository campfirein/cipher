import type {BrConfig} from '../domain/entities/br-config.js'
import type {Space} from '../domain/entities/space.js'
import type {IConfigStore} from '../interfaces/i-config-store.js'
import type {ISpaceService} from '../interfaces/i-space-service.js'
import type {ITokenStore} from '../interfaces/i-token-store.js'

type InitResult = {
  error?: string
  spaces?: Space[]
  success: boolean
}

/**
 * Use case for initializing a project with ByteRover.
 * Handles authentication validation, fetching available spaces, and creating config.
 */
export class InitUseCase {
  private readonly configStore: IConfigStore
  private readonly spaceService: ISpaceService
  private readonly tokenStore: ITokenStore

  public constructor(
    tokenStore: ITokenStore,
    spaceService: ISpaceService,
    configStore: IConfigStore,
  ) {
    this.tokenStore = tokenStore
    this.spaceService = spaceService
    this.configStore = configStore
  }

  /**
   * Checks if the project is already initialized.
   * @param directory The project directory to check (defaults to current working directory)
   * @returns True if .br/config.json exists, false otherwise
   */
  public async checkIfInitialized(directory?: string): Promise<boolean> {
    return this.configStore.exists(directory)
  }

  /**
   * Fetches available spaces for the authenticated user.
   * @returns InitResult with spaces on success, error message on failure
   */
  public async fetchSpaces(): Promise<InitResult> {
    try {
      // Load authentication token
      const token = await this.tokenStore.load()

      if (!token) {
        return {
          error: 'Not authenticated. Please run "br auth login" first.',
          success: false,
        }
      }

      if (!token.isValid()) {
        return {
          error: 'Authentication token expired. Please run "br auth login" again.',
          success: false,
        }
      }

      // Fetch spaces
      const spaces = await this.spaceService.getSpaces(token.accessToken)

      if (spaces.length === 0) {
        return {
          error: 'No spaces found. Please create a space in the ByteRover dashboard first.',
          success: false,
        }
      }

      return {
        spaces,
        success: true,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      return {
        error: errorMessage || 'Unknown error occurred',
        success: false,
      }
    }
  }

  /**
   * Saves the selected space configuration to .br/config.json.
   * @param config The configuration to save
   * @param directory The project directory (defaults to current working directory)
   */
  public async saveConfig(config: BrConfig, directory?: string): Promise<void> {
    await this.configStore.write(config, directory)
  }
}
