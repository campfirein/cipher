import {GLOBAL_CONFIG_VERSION} from '../../../constants.js'

/**
 * Parameters for creating a GlobalConfig instance.
 */
export interface GlobalConfigParams {
  readonly deviceId: string
  readonly version: string
}

/**
 * Type guard for GlobalConfig JSON validation.
 */
const isGlobalConfigJson = (json: unknown): json is GlobalConfigParams => {
  if (typeof json !== 'object' || json === null || json === undefined) return false

  const obj = json as Record<string, unknown>

  if (typeof obj.deviceId !== 'string' || obj.deviceId.trim().length === 0) {
    return false
  }

  if (typeof obj.version !== 'string') {
    return false
  }

  return true
}

/**
 * Represents the global configuration stored in the user's config directory.
 * Contains device-level settings that persist across all projects.
 */
export class GlobalConfig {
  public readonly deviceId: string
  public readonly version: string

  private constructor(params: GlobalConfigParams) {
    this.deviceId = params.deviceId
    this.version = params.version
  }

  /**
   * Creates a new GlobalConfig with the given device ID and current version.
   *
   * @param deviceId - The unique device identifier (UUID v4)
   * @returns A new GlobalConfig instance
   * @throws Error if deviceId is empty
   */
  public static create(deviceId: string): GlobalConfig {
    if (deviceId.trim().length === 0) {
      throw new Error('Device ID cannot be empty')
    }

    return new GlobalConfig({
      deviceId,
      version: GLOBAL_CONFIG_VERSION,
    })
  }

  /**
   * Deserializes config from JSON format.
   * Returns undefined for invalid JSON structure (graceful failure).
   *
   * @param json - The JSON object to deserialize
   * @returns GlobalConfig instance or undefined if invalid
   */
  public static fromJson(json: unknown): GlobalConfig | undefined {
    if (!isGlobalConfigJson(json)) {
      return undefined
    }

    return new GlobalConfig(json)
  }

  /**
   * Serializes the config to JSON format.
   */
  public toJson(): Record<string, string> {
    return {
      deviceId: this.deviceId,
      version: this.version,
    }
  }
}
