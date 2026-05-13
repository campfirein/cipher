/**
 * Channel-protocol error hierarchy (Phase 1).
 *
 * Every concrete subclass exposes the canonical wire code defined in
 * `plan/channel-protocol/CHANNEL_PROTOCOL.md` §11. The channel transport
 * handler (Slice 1.4) catches `ChannelError`, reads `.code`, and forwards it
 * verbatim in the request/response error envelope. CLI surfaces may alias
 * the canonical code to `ERR_BRV_CHANNEL_*` in `--json` output per
 * CHANNEL_PROTOCOL.md §11 "Canonical codes vs CLI aliases".
 *
 * Phase 2 and Phase 3 error subclasses (CHANNEL_MEMBER_*, ACP_*,
 * AGENT_DRIVER_PROFILE_*, etc.) land alongside their respective slices.
 */

export const CHANNEL_ERROR_CODE = {
  ACP_AUTH_REQUIRED: 'ACP_AUTH_REQUIRED',
  ACP_BINARY_NOT_FOUND: 'ACP_BINARY_NOT_FOUND',
  ACP_HANDSHAKE_FAILED: 'ACP_HANDSHAKE_FAILED',
  ACP_HANDSHAKE_TIMEOUT: 'ACP_HANDSHAKE_TIMEOUT',
  ACP_PERMISSION_FAILED: 'ACP_PERMISSION_FAILED',
  ACP_PROMPT_FAILED: 'ACP_PROMPT_FAILED',
  ACP_SESSION_FAILED: 'ACP_SESSION_FAILED',
  // Review fix #14: spec-conformant code constants — CHANNEL_PROTOCOL.md §11
  // lists these as canonical wire codes. They were previously only
  // referenced as literal strings (`'AGENT_DRIVER_PROFILE_NOT_FOUND'`) or
  // not at all. Adding them here registers them with the canonical map
  // so callers can reference them by symbolic constant.
  ACP_VERSION_INCOMPATIBLE: 'ACP_VERSION_INCOMPATIBLE',
  AGENT_DRIVER_PROFILE_INVALID: 'AGENT_DRIVER_PROFILE_INVALID',
  AGENT_DRIVER_PROFILE_NOT_FOUND: 'AGENT_DRIVER_PROFILE_NOT_FOUND',
  ALREADY_EXISTS: 'CHANNEL_ALREADY_EXISTS',
  ARCHIVED: 'CHANNEL_ARCHIVED',
  DELIVERY_NOT_FOUND: 'CHANNEL_DELIVERY_NOT_FOUND',
  // Phase 3 additions ------------------------------------------------------
  DISABLED: 'CHANNEL_DISABLED',
  INVALID_CURSOR: 'CHANNEL_INVALID_CURSOR',
  INVALID_REQUEST: 'CHANNEL_INVALID_REQUEST',
  // Review fix #14: §11 codes for member liveness signals.
  MEMBER_INACTIVE: 'CHANNEL_MEMBER_INACTIVE',
  MEMBER_NOT_FOUND: 'CHANNEL_MEMBER_NOT_FOUND',
  MEMBER_NOT_RESPONDING: 'CHANNEL_MEMBER_NOT_RESPONDING',
  MENTION_EMPTY: 'CHANNEL_MENTION_EMPTY',
  MENTION_RESERVED: 'CHANNEL_MENTION_RESERVED',
  NOT_FOUND: 'CHANNEL_NOT_FOUND',
  PERMISSION_ALREADY_RESOLVED: 'CHANNEL_PERMISSION_ALREADY_RESOLVED',
  PERMISSION_NOT_FOUND: 'CHANNEL_PERMISSION_NOT_FOUND',
  PROFILE_NOT_FOUND: 'CHANNEL_PROFILE_NOT_FOUND',
  PROMPT_EMPTY: 'CHANNEL_PROMPT_EMPTY',
  REQUEST_TIMEOUT: 'CHANNEL_REQUEST_TIMEOUT',
  TURN_NOT_CANCELLABLE: 'CHANNEL_TURN_NOT_CANCELLABLE',
  TURN_NOT_FOUND: 'CHANNEL_TURN_NOT_FOUND',
  UNAUTHORIZED: 'CHANNEL_UNAUTHORIZED',
} as const

export type ChannelErrorCode = (typeof CHANNEL_ERROR_CODE)[keyof typeof CHANNEL_ERROR_CODE]

/**
 * Base class for all channel-domain errors. Carries the canonical wire code
 * (per CHANNEL_PROTOCOL.md §11) and optional structured details for the
 * transport error envelope.
 */
export class ChannelError extends Error {
  public readonly code: string
  public readonly details?: unknown

  public constructor(message: string, code: string, details?: unknown) {
    super(message)
    this.name = 'ChannelError'
    this.code = code
    this.details = details
  }
}

export class ChannelUnauthorizedError extends ChannelError {
  public constructor(reason: string) {
    super(`Channel request unauthorised: ${reason}`, CHANNEL_ERROR_CODE.UNAUTHORIZED)
    this.name = 'ChannelUnauthorizedError'
  }
}

export class ChannelInvalidRequestError extends ChannelError {
  public constructor(message: string, details: unknown) {
    super(message, CHANNEL_ERROR_CODE.INVALID_REQUEST, details)
    this.name = 'ChannelInvalidRequestError'
  }
}

export class ChannelNotFoundError extends ChannelError {
  public readonly channelId: string

  public constructor(channelId: string) {
    super(`Channel #${channelId} not found`, CHANNEL_ERROR_CODE.NOT_FOUND)
    this.name = 'ChannelNotFoundError'
    this.channelId = channelId
  }
}

export class ChannelAlreadyExistsError extends ChannelError {
  public readonly channelId: string

  public constructor(channelId: string) {
    super(`Channel #${channelId} already exists`, CHANNEL_ERROR_CODE.ALREADY_EXISTS)
    this.name = 'ChannelAlreadyExistsError'
    this.channelId = channelId
  }
}

export class ChannelArchivedError extends ChannelError {
  public readonly channelId: string

  public constructor(channelId: string) {
    super(`Channel #${channelId} is archived`, CHANNEL_ERROR_CODE.ARCHIVED)
    this.name = 'ChannelArchivedError'
    this.channelId = channelId
  }
}

export class ChannelInvalidCursorError extends ChannelError {
  public readonly cursor: string

  public constructor(cursor: string) {
    super(`Invalid pagination cursor: ${cursor}`, CHANNEL_ERROR_CODE.INVALID_CURSOR)
    this.name = 'ChannelInvalidCursorError'
    this.cursor = cursor
  }
}

export class ChannelPromptEmptyError extends ChannelError {
  public constructor() {
    super(
      'Request rejected: prompt and promptBlocks are both effectively empty (CHANNEL_PROTOCOL.md §8.4).',
      CHANNEL_ERROR_CODE.PROMPT_EMPTY,
    )
    this.name = 'ChannelPromptEmptyError'
  }
}

export class ChannelTurnNotFoundError extends ChannelError {
  public readonly channelId: string
  public readonly turnId: string

  public constructor(channelId: string, turnId: string) {
    super(`Turn ${turnId} not found in channel #${channelId}`, CHANNEL_ERROR_CODE.TURN_NOT_FOUND)
    this.name = 'ChannelTurnNotFoundError'
    this.channelId = channelId
    this.turnId = turnId
  }
}

// ─── Phase-2 error subclasses ───────────────────────────────────────────────

export class ChannelMentionEmptyError extends ChannelError {
  public constructor() {
    super(
      'channel:mention rejected: no resolvable mentions in the request (CHANNEL_PROTOCOL.md §8.4).',
      CHANNEL_ERROR_CODE.MENTION_EMPTY,
    )
    this.name = 'ChannelMentionEmptyError'
  }
}

export class ChannelMentionReservedError extends ChannelError {
  public readonly handle: string

  public constructor(handle: string) {
    super(`Reserved mention ${handle} (e.g. @everyone, @all) is not supported in v0.1.`, CHANNEL_ERROR_CODE.MENTION_RESERVED)
    this.name = 'ChannelMentionReservedError'
    this.handle = handle
  }
}

export class ChannelMemberNotFoundError extends ChannelError {
  public constructor(unknownHandles: string[], knownHandles: string[]) {
    super(
      `Unknown channel member(s): ${unknownHandles.join(', ')}`,
      CHANNEL_ERROR_CODE.MEMBER_NOT_FOUND,
      {knownHandles, unknownHandles},
    )
    this.name = 'ChannelMemberNotFoundError'
  }
}

export class ChannelPermissionNotFoundError extends ChannelError {
  public readonly permissionRequestId: string

  public constructor(permissionRequestId: string) {
    super(
      `Permission request ${permissionRequestId} not found or already gone`,
      CHANNEL_ERROR_CODE.PERMISSION_NOT_FOUND,
    )
    this.name = 'ChannelPermissionNotFoundError'
    this.permissionRequestId = permissionRequestId
  }
}

export class ChannelPermissionAlreadyResolvedError extends ChannelError {
  public readonly permissionRequestId: string

  public constructor(permissionRequestId: string) {
    super(
      `Permission request ${permissionRequestId} has already been resolved`,
      CHANNEL_ERROR_CODE.PERMISSION_ALREADY_RESOLVED,
    )
    this.name = 'ChannelPermissionAlreadyResolvedError'
    this.permissionRequestId = permissionRequestId
  }
}

export class ChannelDeliveryNotFoundError extends ChannelError {
  public constructor(channelId: string, turnId: string, deliveryId: string) {
    super(
      `Delivery ${deliveryId} not found in turn ${turnId} of channel #${channelId}`,
      CHANNEL_ERROR_CODE.DELIVERY_NOT_FOUND,
    )
    this.name = 'ChannelDeliveryNotFoundError'
  }
}

export class ChannelTurnNotCancellableError extends ChannelError {
  public constructor(channelId: string, turnId: string) {
    super(
      `Turn ${turnId} in channel #${channelId} has no in-flight deliveries to cancel`,
      CHANNEL_ERROR_CODE.TURN_NOT_CANCELLABLE,
    )
    this.name = 'ChannelTurnNotCancellableError'
  }
}

/**
 * Subset of the ACP `AuthMethod` shape that the channel layer cares about.
 * Carried by AcpAuthRequiredError so the onboard service / CLI can render
 * a useful remediation hint (e.g. "run `kimi login` and retry").
 */
export type ChannelAuthMethod = {
  readonly description?: string
  readonly fieldMeta?: {
    readonly terminalAuth?: {
      readonly args?: readonly string[]
      readonly command: string
      readonly env?: Readonly<Record<string, string>>
    }
  }
  readonly id: string
  readonly name?: string
}

/**
 * Raised when an ACP agent refuses the startup handshake (`initialize` or
 * `session/new`) because the user is not authenticated. Real-world example:
 * `kimi acp` returns JSON-RPC error code -32000 with `data.authMethods`
 * when the user has not run `kimi login` (see Slice 4.2). Defensive
 * fallback codes -32602 and the symbolic 'AUTH_REQUIRED' string are also
 * classified into this error.
 */
export class AcpAuthRequiredError extends ChannelError {
  public readonly authMethods: readonly ChannelAuthMethod[]
  public readonly handle: string

  public constructor(handle: string, authMethods: readonly ChannelAuthMethod[]) {
    super(
      `ACP agent ${handle} refused the handshake: AUTH_REQUIRED`,
      CHANNEL_ERROR_CODE.ACP_AUTH_REQUIRED,
      {authMethods},
    )
    this.name = 'AcpAuthRequiredError'
    this.authMethods = authMethods
    this.handle = handle
  }
}

/**
 * Slice 4.4 — translated from `child_process.spawn` ENOENT so the CLI can
 * render a useful "is it on your PATH?" message instead of leaking a raw
 * node error string.
 */
export class AcpBinaryNotFoundError extends ChannelError {
  public readonly command: string

  public constructor(command: string) {
    super(
      `ACP binary "${command}" was not found — is it installed and on your PATH?`,
      CHANNEL_ERROR_CODE.ACP_BINARY_NOT_FOUND,
      {command},
    )
    this.name = 'AcpBinaryNotFoundError'
    this.command = command
  }
}

/**
 * Slice 4.4 — pure helper so the handshake timeout is testable without
 * spawning a child. Reads `BRV_ACP_HANDSHAKE_TIMEOUT_MS`; falls back to
 * 15_000 ms on invalid / non-positive values.
 */
export const resolveHandshakeTimeoutMs = (env: Readonly<Record<string, string | undefined>>): number => {
  const DEFAULT_MS = 15_000
  const raw = env.BRV_ACP_HANDSHAKE_TIMEOUT_MS
  if (raw === undefined || raw === '') return DEFAULT_MS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MS
  return parsed
}

export class AcpHandshakeFailedError extends ChannelError {
  public readonly handle: string

  public constructor(handle: string, reason: string) {
    super(`ACP handshake failed for ${handle}: ${reason}`, CHANNEL_ERROR_CODE.ACP_HANDSHAKE_FAILED)
    this.name = 'AcpHandshakeFailedError'
    this.handle = handle
  }
}

export class AcpSessionFailedError extends ChannelError {
  public constructor(reason: string) {
    super(`ACP session/new failed: ${reason}`, CHANNEL_ERROR_CODE.ACP_SESSION_FAILED)
    this.name = 'AcpSessionFailedError'
  }
}

export class AcpPromptFailedError extends ChannelError {
  public constructor(reason: string) {
    super(`ACP session/prompt failed: ${reason}`, CHANNEL_ERROR_CODE.ACP_PROMPT_FAILED)
    this.name = 'AcpPromptFailedError'
  }
}

export class AcpPermissionFailedError extends ChannelError {
  public readonly permissionRequestId: string

  public constructor(permissionRequestId: string, reason: string) {
    super(
      `ACP permission response for ${permissionRequestId} could not be delivered: ${reason}`,
      CHANNEL_ERROR_CODE.ACP_PERMISSION_FAILED,
    )
    this.name = 'AcpPermissionFailedError'
    this.permissionRequestId = permissionRequestId
  }
}

// ─── Phase-3 errors ─────────────────────────────────────────────────────────

/**
 * Returned by every `channel:*` stub handler when the host has channels
 * administratively disabled (e.g. `BRV_CHANNELS_ENABLED=false`). The stub
 * registration prevents the ack callback from hanging — see DESIGN.md and
 * IMPLEMENTATION_PHASE_3.md §3.5.
 */
export class ChannelDisabledError extends ChannelError {
  public constructor(message?: string) {
    super(
      message ?? 'Channel surface is disabled on this host (BRV_CHANNELS_ENABLED is unset or false)',
      CHANNEL_ERROR_CODE.DISABLED,
    )
    this.name = 'ChannelDisabledError'
  }
}

/**
 * Client-side error raised by `ChannelClient.request()` when the daemon ack
 * does not arrive within the configured timeout. Hosts never throw this —
 * it's a client safety net.
 */
export class ChannelRequestTimeoutError extends ChannelError {
  public readonly event: string
  public readonly timeoutMs: number

  public constructor(event: string, timeoutMs: number) {
    super(
      `Channel request "${event}" did not receive a response within ${timeoutMs}ms`,
      CHANNEL_ERROR_CODE.REQUEST_TIMEOUT,
    )
    this.name = 'ChannelRequestTimeoutError'
    this.event = event
    this.timeoutMs = timeoutMs
  }
}

/**
 * `channel:profile-show` referenced a profile name that is not in the
 * registry. `channel:profile-remove` does NOT raise this — see §11.
 */
export class ChannelProfileNotFoundError extends ChannelError {
  public readonly profileName: string

  public constructor(profileName: string) {
    super(`Driver profile not found: ${profileName}`, CHANNEL_ERROR_CODE.PROFILE_NOT_FOUND)
    this.name = 'ChannelProfileNotFoundError'
    this.profileName = profileName
  }
}

/**
 * `channel:invite` referenced a `profileName` that the driver-profile
 * registry does not know. Carries the canonical §11 code
 * `AGENT_DRIVER_PROFILE_NOT_FOUND` rather than the channel-side
 * `CHANNEL_PROFILE_NOT_FOUND` so the wire surface mirrors the spec's
 * `AGENT_*` family for the driver-profile registry.
 */
export class AgentDriverProfileNotFoundError extends ChannelError {
  public readonly profileName: string

  public constructor(profileName: string) {
    super(`Agent driver profile not found: ${profileName}`, CHANNEL_ERROR_CODE.AGENT_DRIVER_PROFILE_NOT_FOUND)
    this.name = 'AgentDriverProfileNotFoundError'
    this.profileName = profileName
  }
}
