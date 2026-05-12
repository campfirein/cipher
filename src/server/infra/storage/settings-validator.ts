import type {SettingDescriptor} from '../../core/domain/entities/settings.js'

import {findSettingDescriptor} from '../../core/domain/entities/settings.js'

export class UnknownSettingKeyError extends Error {
  public readonly key: string

  public constructor(key: string) {
    super(`Unknown settings key: '${key}'. Run 'brv settings list' to see available keys.`)
    this.name = 'UnknownSettingKeyError'
    this.key = key
  }
}

export class InvalidSettingValueError extends Error {
  public readonly key: string
  public readonly value: unknown

  public constructor(key: string, value: unknown, reason: string) {
    super(`Invalid value for setting '${key}': ${reason}.`)
    this.name = 'InvalidSettingValueError'
    this.key = key
    this.value = value
  }
}

export type PartitionedSettings = {
  readonly invalid: ReadonlyArray<{readonly key: string; readonly reason: string; readonly value: unknown}>
  readonly valid: Readonly<Record<string, number>>
}

/**
 * Single source of truth for settings validation. Used by the store to gate
 * writes and by daemon startup to filter a raw on-disk record into the valid
 * subset that should be applied (plus a list of rejected entries for logging).
 *
 * Coupling rules (e.g. `requestTimeoutMs <= iterationBudgetMs`) plug in here
 * when M3 lands; the store and the transport handler do not need to change.
 */
export class SettingsValidator {
  /**
   * Splits a raw record (e.g. parsed from `settings.json`) into the valid
   * entries the daemon should apply and the invalid entries the daemon should
   * log a warning about.
   */
  public partition(record: Record<string, unknown>): PartitionedSettings {
    const valid: Record<string, number> = {}
    const invalid: Array<{key: string; reason: string; value: unknown}> = []

    for (const [key, value] of Object.entries(record)) {
      const descriptor = findSettingDescriptor(key)
      if (descriptor === undefined) {
        invalid.push({key, reason: 'unknown settings key', value})
        continue
      }

      try {
        valid[key] = this.validateAgainst(descriptor, value)
      } catch (error) {
        if (error instanceof InvalidSettingValueError) {
          invalid.push({key, reason: error.message, value: error.value})
          continue
        }

        throw error
      }
    }

    return {invalid, valid}
  }

  /**
   * Validates a single key/value pair. Throws on unknown key or invalid value.
   * Returns the coerced numeric value on success.
   */
  public validate(key: string, value: unknown): number {
    const descriptor = this.validateKey(key)
    return this.validateAgainst(descriptor, value)
  }

  /**
   * Returns the descriptor for `key`. Throws `UnknownSettingKeyError` if the
   * key is not registered.
   */
  public validateKey(key: string): SettingDescriptor {
    const descriptor = findSettingDescriptor(key)
    if (descriptor === undefined) throw new UnknownSettingKeyError(key)
    return descriptor
  }

  private validateAgainst(descriptor: SettingDescriptor, value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new InvalidSettingValueError(
        descriptor.key,
        value,
        `expected integer, got ${describeType(value)}`,
      )
    }

    if (value < descriptor.min || value > descriptor.max) {
      throw new InvalidSettingValueError(
        descriptor.key,
        value,
        `value ${value} is outside allowed range [${descriptor.min}, ${descriptor.max}]`,
      )
    }

    return value
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number' && !Number.isInteger(value)) return 'non-integer number'
  return typeof value
}
