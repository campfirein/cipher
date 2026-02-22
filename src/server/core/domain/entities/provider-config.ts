/**
 * Provider Configuration Entity
 *
 * Stores user's provider preferences and connection state.
 * Non-sensitive data (API keys stored separately in keychain).
 */

/**
 * Configuration for a single connected provider.
 */
export interface ConnectedProviderConfig {
  /** Currently active model for this provider */
  readonly activeModel?: string
  /** Custom API base URL (for openai-compatible provider) */
  readonly baseUrl?: string
  /** When the provider was connected */
  readonly connectedAt: string
  /** User's favorite models (for quick access) */
  readonly favoriteModels: readonly string[]
  /** Recently used models (last 10) */
  readonly recentModels: readonly string[]
}

/**
 * Parameters for creating a ProviderConfig.
 */
export interface ProviderConfigParams {
  /** Currently active provider ID */
  readonly activeProvider: string
  /** Configuration for each connected provider */
  readonly providers: Readonly<Record<string, ConnectedProviderConfig>>
}

/**
 * Type guard for ProviderConfig JSON validation.
 */
const isProviderConfigJson = (json: unknown): json is ProviderConfigParams => {
  if (typeof json !== 'object' || json === null) return false

  const obj = json as Record<string, unknown>

  if (typeof obj.activeProvider !== 'string') return false
  if (typeof obj.providers !== 'object' || obj.providers === null) return false

  return true
}

/**
 * Default configuration when no providers are connected.
 */
export const DEFAULT_PROVIDER_CONFIG: ProviderConfigParams = {
  activeProvider: '',
  providers: {},
}

/**
 * Maximum number of recent models to track.
 */
const MAX_RECENT_MODELS = 10

/**
 * Represents the provider configuration for the CLI.
 * Tracks which providers are connected and user preferences.
 */
export class ProviderConfig {
  public readonly activeProvider: string
  public readonly providers: Readonly<Record<string, ConnectedProviderConfig>>

  private constructor(params: ProviderConfigParams) {
    this.activeProvider = params.activeProvider
    this.providers = params.providers
  }

  /**
   * Creates a new ProviderConfig with default values.
   */
  public static createDefault(): ProviderConfig {
    return new ProviderConfig(DEFAULT_PROVIDER_CONFIG)
  }

  /**
   * Deserializes config from JSON format.
   * Returns default config for invalid JSON structure.
   */
  public static fromJson(json: unknown): ProviderConfig {
    if (!isProviderConfigJson(json)) {
      return ProviderConfig.createDefault()
    }

    return new ProviderConfig(json)
  }

  /**
   * Get the active model for a provider.
   */
  public getActiveModel(providerId: string): string | undefined {
    return this.providers[providerId]?.activeModel
  }

  /**
   * Get the custom base URL for a provider (e.g., openai-compatible).
   */
  public getBaseUrl(providerId: string): string | undefined {
    return this.providers[providerId]?.baseUrl
  }

  /**
   * Get favorite models for a provider.
   */
  public getFavoriteModels(providerId: string): readonly string[] {
    return this.providers[providerId]?.favoriteModels ?? []
  }

  /**
   * Get recent models for a provider.
   */
  public getRecentModels(providerId: string): readonly string[] {
    return this.providers[providerId]?.recentModels ?? []
  }

  /**
   * Check if a provider is connected.
   */
  public isProviderConnected(providerId: string): boolean {
    return providerId in this.providers
  }

  /**
   * Serializes the config to JSON format.
   */
  public toJson(): ProviderConfigParams {
    return {
      activeProvider: this.activeProvider,
      providers: this.providers,
    }
  }

  /**
   * Create a new config with the active model changed for a provider.
   */
  public withActiveModel(providerId: string, modelId: string): ProviderConfig {
    const existingConfig = this.providers[providerId]
    if (!existingConfig) {
      return this
    }

    // Add to recent models (at the front, deduplicated)
    const recentModels = [modelId, ...existingConfig.recentModels.filter((m) => m !== modelId)].slice(
      0,
      MAX_RECENT_MODELS,
    )

    const newProviderConfig: ConnectedProviderConfig = {
      ...existingConfig,
      activeModel: modelId,
      recentModels,
    }

    return new ProviderConfig({
      ...this.toJson(),
      providers: {
        ...this.providers,
        [providerId]: newProviderConfig,
      },
    })
  }

  /**
   * Create a new config with the active provider changed.
   */
  public withActiveProvider(providerId: string): ProviderConfig {
    return new ProviderConfig({
      ...this.toJson(),
      activeProvider: providerId,
    })
  }

  /**
   * Create a new config with a model toggled as favorite.
   */
  public withFavoriteToggled(providerId: string, modelId: string): ProviderConfig {
    const existingConfig = this.providers[providerId]
    if (!existingConfig) {
      return this
    }

    const isFavorite = existingConfig.favoriteModels.includes(modelId)
    const favoriteModels = isFavorite
      ? existingConfig.favoriteModels.filter((m) => m !== modelId)
      : [...existingConfig.favoriteModels, modelId]

    const newProviderConfig: ConnectedProviderConfig = {
      ...existingConfig,
      favoriteModels,
    }

    return new ProviderConfig({
      ...this.toJson(),
      providers: {
        ...this.providers,
        [providerId]: newProviderConfig,
      },
    })
  }

  /**
   * Create a new config with a provider connected.
   */
  public withProviderConnected(providerId: string, options?: {activeModel?: string; baseUrl?: string}): ProviderConfig {
    const existingConfig = this.providers[providerId]
    const newProviderConfig: ConnectedProviderConfig = {
      activeModel: options?.activeModel ?? existingConfig?.activeModel,
      baseUrl: options?.baseUrl ?? existingConfig?.baseUrl,
      connectedAt: existingConfig?.connectedAt ?? new Date().toISOString(),
      favoriteModels: existingConfig?.favoriteModels ?? [],
      recentModels: existingConfig?.recentModels ?? [],
    }

    return new ProviderConfig({
      ...this.toJson(),
      providers: {
        ...this.providers,
        [providerId]: newProviderConfig,
      },
    })
  }

  /**
   * Create a new config with a provider disconnected.
   */
  public withProviderDisconnected(providerId: string): ProviderConfig {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {[providerId]: _removed, ...remainingProviders} = this.providers
    const newActiveProvider = this.activeProvider === providerId ? 'byterover' : this.activeProvider

    return new ProviderConfig({
      activeProvider: newActiveProvider,
      providers: remainingProviders,
    })
  }
}
