/* eslint-disable camelcase */
import type {AnalyticsEvent} from './event.js'
import type {Identity} from './identity.js'

/**
 * An analytics event after identity stamping. This is the unit of work
 * that flows through the queue and ultimately ends up on the wire.
 */
export type AnalyticsEventWithIdentity = AnalyticsEvent & Readonly<{identity: Identity}>

/**
 * Wire shape for a batch of analytics events. `schema_version: 1` is the
 * only currently-supported value.
 */
export type AnalyticsBatchJson = Readonly<{
  events: ReadonlyArray<AnalyticsEventWithIdentity>
  schema_version: 1
}>

const isIdentity = (value: unknown): value is Identity => {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  if (typeof obj.device_id !== 'string' || obj.device_id.trim().length === 0) {
    return false
  }

  if (obj.user_id !== undefined && typeof obj.user_id !== 'string') return false
  if (obj.email !== undefined && typeof obj.email !== 'string') return false
  if (obj.name !== undefined && typeof obj.name !== 'string') return false

  return true
}

const isAnalyticsEventWithIdentity = (value: unknown): value is AnalyticsEventWithIdentity => {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>

  if (typeof obj.name !== 'string') return false
  if (typeof obj.timestamp !== 'number') return false
  if (typeof obj.properties !== 'object' || obj.properties === null || Array.isArray(obj.properties)) return false
  if (!isIdentity(obj.identity)) return false

  return true
}

const isAnalyticsBatchJson = (json: unknown): json is AnalyticsBatchJson => {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return false
  const obj = json as Record<string, unknown>

  if (obj.schema_version !== 1) return false
  if (!Array.isArray(obj.events)) return false

  return obj.events.every((event) => isAnalyticsEventWithIdentity(event))
}

/**
 * A batch of identity-stamped analytics events. Immutable. Constructed
 * via `create()` in-process or `fromJson()` at the wire boundary;
 * `toJson()` produces the canonical `AnalyticsBatchJson` shape.
 */
export class AnalyticsBatch {
  public readonly events: ReadonlyArray<AnalyticsEventWithIdentity>
  public readonly schema_version: 1

  private constructor(events: ReadonlyArray<AnalyticsEventWithIdentity>) {
    this.events = events
    this.schema_version = 1
  }

  /**
   * Constructs a batch from a list of identity-stamped events.
   */
  public static create(events: ReadonlyArray<AnalyticsEventWithIdentity>): AnalyticsBatch {
    return new AnalyticsBatch(events)
  }

  /**
   * Deserializes a batch from JSON. Returns `undefined` for any malformed
   * input (graceful failure — the caller can drop the batch and log).
   */
  public static fromJson(json: unknown): AnalyticsBatch | undefined {
    if (!isAnalyticsBatchJson(json)) return undefined
    return new AnalyticsBatch(json.events)
  }

  /**
   * Serializes the batch to its wire shape.
   */
  public toJson(): AnalyticsBatchJson {
    return {events: this.events, schema_version: this.schema_version}
  }
}
