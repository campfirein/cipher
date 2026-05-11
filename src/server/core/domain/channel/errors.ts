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
  ALREADY_EXISTS: 'CHANNEL_ALREADY_EXISTS',
  ARCHIVED: 'CHANNEL_ARCHIVED',
  INVALID_CURSOR: 'CHANNEL_INVALID_CURSOR',
  INVALID_REQUEST: 'CHANNEL_INVALID_REQUEST',
  NOT_FOUND: 'CHANNEL_NOT_FOUND',
  PROMPT_EMPTY: 'CHANNEL_PROMPT_EMPTY',
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
