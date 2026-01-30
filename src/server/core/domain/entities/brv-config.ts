import {BRV_CONFIG_VERSION} from '../../../constants.js'
import {BrvConfigVersionError} from '../errors/brv-config-version-error.js'
import {Agent, AGENT_VALUES} from './agent.js'
import {Space} from './space.js'

/**
 * Parameters for creating a BrvConfig instance.
 */
export type BrvConfigParams = {
  chatLogPath: string
  cipherAgentContext?: string
  cipherAgentModes?: string[]
  cipherAgentSystemPrompt?: string
  createdAt: string
  cwd: string
  ide: Agent
  spaceId: string
  spaceName: string
  teamId: string
  teamName: string
  version: string
}

/**
 * Parameters for creating a BrvConfig from a Space entity.
 */
export type FromSpaceParams = {
  chatLogPath: string
  cwd: string
  ide: Agent
  space: Space
}

/**
 * Shape of JSON read from .brv/config.json (version may be missing in old configs).
 */
type BrvConfigFromJson = Omit<BrvConfigParams, 'version'> & {
  version?: string
}

/**
 * Type guard for Agent validation
 */
const isCodingAgent = (value: unknown): value is Agent => {
  if (typeof value !== 'string') return false
  for (const agent of AGENT_VALUES) {
    if (agent === value) return true
  }

  return false
}

/**
 * Type guard for BrvConfigFromJson - validates JSON structure at runtime.
 * Note: version is optional in this check (old configs may not have it).
 */
const isBrvConfigJson = (json: unknown): json is BrvConfigFromJson => {
  if (typeof json !== 'object' || json === null) return false

  const requiredInputJsonKeys = [
    'chatLogPath',
    'createdAt',
    'cwd',
    'spaceId',
    'spaceName',
    'teamId',
    'teamName',
  ] as const satisfies readonly (keyof BrvConfigFromJson)[]

  for (const key of requiredInputJsonKeys) {
    if (!(key in json) || typeof (json as Record<string, unknown>)[key] !== 'string') {
      return false
    }
  }

  if (!('ide' in json) || !isCodingAgent((json as Record<string, unknown>).ide)) {
    return false
  }

  // Check optional fields if present
  const obj = json as Record<string, unknown>
  if (obj.cipherAgentContext !== undefined && typeof obj.cipherAgentContext !== 'string') return false
  if (obj.cipherAgentSystemPrompt !== undefined && typeof obj.cipherAgentSystemPrompt !== 'string') return false
  if (obj.cipherAgentModes !== undefined && !Array.isArray(obj.cipherAgentModes)) return false
  if (obj.version !== undefined && typeof obj.version !== 'string') return false

  return true
}

/**
 * Represents the configuration stored in .brv/config.json
 * This config links a project directory to a ByteRover space.
 */
export class BrvConfig {
  public readonly chatLogPath: string
  public readonly cipherAgentContext?: string
  public readonly cipherAgentModes?: string[]
  public readonly cipherAgentSystemPrompt?: string
  public readonly createdAt: string
  public readonly cwd: string
  public readonly ide: Agent
  public readonly spaceId: string
  public readonly spaceName: string
  public readonly teamId: string
  public readonly teamName: string
  public readonly version: string

  public constructor(params: BrvConfigParams) {
    if (params.createdAt.trim().length === 0) {
      throw new Error('Created at cannot be empty')
    }

    if (params.spaceId.trim().length === 0) {
      throw new Error('Space ID cannot be empty')
    }

    if (params.spaceName.trim().length === 0) {
      throw new Error('Space name cannot be empty')
    }

    if (params.teamId.trim().length === 0) {
      throw new Error('Team ID cannot be empty')
    }

    if (params.teamName.trim().length === 0) {
      throw new Error('Team name cannot be empty')
    }

    this.chatLogPath = params.chatLogPath
    this.cipherAgentContext = params.cipherAgentContext
    this.cipherAgentModes = params.cipherAgentModes
    this.cipherAgentSystemPrompt = params.cipherAgentSystemPrompt
    this.createdAt = params.createdAt
    this.cwd = params.cwd
    this.ide = params.ide
    this.spaceId = params.spaceId
    this.spaceName = params.spaceName
    this.teamId = params.teamId
    this.teamName = params.teamName
    this.version = params.version
  }

  /**
   * Deserializes config from JSON format.
   * @throws Error if the JSON structure is invalid.
   * @throws BrvConfigVersionError if version is missing or mismatched.
   */
  public static fromJson(json: unknown): BrvConfig {
    // Minimal check if json is an object
    if (typeof json !== 'object' || json === null || json === undefined) {
      throw new Error('BrvConfig JSON must be an object')
    }

    // Check version FIRST (before full structure validation)
    // This ensures outdated configs get a helpful version error
    // instead of a generic structure error
    const jsonObj = json as Record<string, unknown>
    const version = typeof jsonObj.version === 'string' ? jsonObj.version : undefined

    if (version === undefined) {
      throw new BrvConfigVersionError({
        currentVersion: undefined,
        expectedVersion: BRV_CONFIG_VERSION,
      })
    }

    if (version !== BRV_CONFIG_VERSION) {
      throw new BrvConfigVersionError({
        currentVersion: version,
        expectedVersion: BRV_CONFIG_VERSION,
      })
    }

    if (!isBrvConfigJson(json)) {
      throw new Error('Invalid BrvConfig JSON structure')
    }

    return new BrvConfig({...json, version})
  }

  /**
   * Creates a BrvConfig from a Space entity.
   */
  public static fromSpace(params: FromSpaceParams): BrvConfig {
    return new BrvConfig({
      chatLogPath: params.chatLogPath,
      createdAt: new Date().toISOString(),
      cwd: params.cwd,
      ide: params.ide,
      spaceId: params.space.id,
      spaceName: params.space.name,
      teamId: params.space.teamId,
      teamName: params.space.teamName,
      version: BRV_CONFIG_VERSION,
    })
  }

  /**
   * Serializes the config to JSON format
   */
  public toJson(): Record<string, unknown> {
    return {
      chatLogPath: this.chatLogPath,
      cipherAgentContext: this.cipherAgentContext,
      cipherAgentModes: this.cipherAgentModes,
      cipherAgentSystemPrompt: this.cipherAgentSystemPrompt,
      createdAt: this.createdAt,
      cwd: this.cwd,
      ide: this.ide,
      spaceId: this.spaceId,
      spaceName: this.spaceName,
      teamId: this.teamId,
      teamName: this.teamName,
      version: this.version,
    }
  }
}
