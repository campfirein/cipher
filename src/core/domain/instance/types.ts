import {TRANSPORT_HOST} from '../../../constants.js'

/**
 * Raw instance data as stored in instance.json.
 * Used for serialization/deserialization.
 *
 * NOTE: We don't store "status" - we check pid alive at runtime instead.
 * This avoids stale status when process crashes.
 */
export type InstanceInfoJson = {
  /** Current active session ID (for quick lookup without DB query) */
  currentSessionId: null | string
  /** Process ID of the Core process */
  pid: number
  /** Port the transport server is listening on */
  port: number
  /** Timestamp when instance started (ms since epoch) */
  startedAt: number
}

/**
 * Instance information representing a BRV Core process.
 *
 * Architecture note (Section 7):
 * - File exists + pid alive  → instance đang chạy
 * - File exists + pid dead   → stale (crash), có thể overwrite
 * - File không có            → không có instance nào
 */
export class InstanceInfo {
  public readonly currentSessionId: null | string
  public readonly pid: number
  public readonly port: number
  public readonly startedAt: Date

  private constructor(data: {currentSessionId: null | string; pid: number; port: number; startedAt: Date}) {
    this.currentSessionId = data.currentSessionId
    this.pid = data.pid
    this.port = data.port
    this.startedAt = data.startedAt
  }

  /**
   * Creates a new instance info.
   */
  public static create(data: {currentSessionId?: null | string; pid: number; port: number}): InstanceInfo {
    return new InstanceInfo({
      currentSessionId: data.currentSessionId ?? null,
      pid: data.pid,
      port: data.port,
      startedAt: new Date(),
    })
  }

  /**
   * Creates instance info from JSON data (from instance.json file).
   */
  public static fromJson(json: InstanceInfoJson): InstanceInfo {
    return new InstanceInfo({
      currentSessionId: json.currentSessionId,
      pid: json.pid,
      port: json.port,
      startedAt: new Date(json.startedAt),
    })
  }

  /**
   * Returns the transport URL for connecting to this instance.
   * Uses 'localhost' instead of '127.0.0.1' for better sandbox compatibility.
   */
  public getTransportUrl(): string {
    return `http://${TRANSPORT_HOST}:${this.port}`
  }

  /**
   * Converts instance info to JSON for persistence.
   */
  public toJson(): InstanceInfoJson {
    return {
      currentSessionId: this.currentSessionId,
      pid: this.pid,
      port: this.port,
      startedAt: this.startedAt.getTime(),
    }
  }

  /**
   * Creates a new instance info with updated session ID.
   */
  public withSessionId(sessionId: string): InstanceInfo {
    return new InstanceInfo({
      currentSessionId: sessionId,
      pid: this.pid,
      port: this.port,
      startedAt: this.startedAt,
    })
  }
}
