export class ChannelError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ChannelError'
  }
}

export class ChannelNotFoundError extends ChannelError {
  public constructor(channelId: string) {
    super('CHANNEL_NOT_FOUND', `Channel "${channelId}" does not exist.`)
  }
}

export class ChannelTreeNotFoundError extends ChannelError {
  public readonly suggestions = [
    {action: 'brv init', scope: 'project' as const},
    {action: 'brv channel new <id> --global', scope: 'global' as const},
    {action: 'brv channel new <id> --isolated', scope: 'isolated' as const},
  ]

  public constructor(public readonly cwd: string, public readonly resolvedProjectRoot: string) {
    super('CHANNEL_TREE_NOT_FOUND', 'No ByteRover context tree found.')
  }
}

export class ChannelAlreadyExistsError extends ChannelError {
  public constructor(channelId: string) {
    super('CHANNEL_ALREADY_EXISTS', `Channel "${channelId}" already exists.`)
  }
}

export class ChannelStorageParseError extends ChannelError {
  public constructor(public readonly path: string, details: string) {
    super('CHANNEL_STORAGE_PARSE_ERROR', `Could not parse channel storage file "${path}": ${details}`)
  }
}

export class InvalidTransitionError extends ChannelError {
  public constructor(from: string, event: string) {
    super('INVALID_TRANSITION', `Cannot transition from "${from}" via "${event}".`)
  }
}

export class AgentNotAvailableError extends ChannelError {
  public constructor(agentId: string) {
    super('AGENT_NOT_AVAILABLE', `Agent "${agentId}" is not installed or not reachable.`)
  }
}

export class AgentUnknownError extends ChannelError {
  public constructor(agentId: string) {
    super('AGENT_UNKNOWN', `No registered agent with id "${agentId}".`)
  }
}

export class AgentNotInstalledError extends ChannelError {
  public constructor(agentId: string, public readonly remediationCommand: string) {
    super('AGENT_NOT_INSTALLED', `Agent "${agentId}" is registered but not installed. Run: ${remediationCommand}`)
  }
}

export class AgentNotInvitableError extends ChannelError {
  public constructor(agentId: string) {
    super('AGENT_NOT_INVITABLE', `Agent "${agentId}" is an external reader and cannot be invited to a channel.`)
  }
}

export class MentionParseError extends ChannelError {
  public constructor(prompt: string) {
    super('MENTION_PARSE_ERROR', `Could not parse mentions from prompt: ${prompt}`)
  }
}

/** Phase 2 — ACP subprocess failed handshake (initialize / newSession) before producing any events. */
export class AcpHandshakeError extends ChannelError {
  public constructor(public readonly agentId: string, details: string) {
    super('ACP_HANDSHAKE_FAILED', `ACP handshake with "${agentId}" failed: ${details}`)
  }
}

/** Phase 2 — adapter reported an ACP protocol version we don't support. Advisory in v1; doctor turns it actionable in Phase 4. */
export class AcpProtocolMismatchError extends ChannelError {
  public constructor(public readonly agentId: string, public readonly reportedVersion: string, public readonly supportedVersion: string) {
    super('ACP_PROTOCOL_MISMATCH', `Agent "${agentId}" reports ACP protocol ${reportedVersion}; expected ${supportedVersion}.`)
  }
}

/** Phase 2 — broker timed out waiting for a permission decision. Orchestrator transitions the turn to `expired`. */
export class PermissionExpiredError extends ChannelError {
  public constructor(public readonly turnId: string) {
    super('PERMISSION_EXPIRED', `Permission decision for turn "${turnId}" timed out.`)
  }
}

/** Phase 2 — programmer error: decide() called for a turn the broker never parked. */
export class UnknownPermissionRequestError extends ChannelError {
  public constructor(public readonly turnId: string) {
    super('UNKNOWN_PERMISSION_REQUEST', `No parked permission request for turn "${turnId}".`)
  }
}

/** Phase 2 — launch kinds reserved for v1.1 (`tcp`) trip this; lets `createDriver()` stay total. */
export class NotImplementedError extends ChannelError {
  public constructor(feature: string) {
    super('NOT_IMPLEMENTED', `${feature} is not implemented in this version.`)
  }
}

/**
 * Phase 2 review (Codex F4) — driver detected that the prompt was cancelled
 * (either via `requestCancel()` or because the ACP server returned `stopReason: 'cancelled'`).
 * The orchestrator catches this and applies `transition(turn, {type: 'cancel'})` so the persisted
 * turn state matches what actually happened, instead of the prompt's natural completion/failure.
 */
export class TurnCancelledError extends ChannelError {
  public constructor(public readonly turnId: string, reason = 'turn cancelled') {
    super('TURN_CANCELLED', `Turn "${turnId}" was cancelled: ${reason}`)
  }
}

/**
 * Phase 2 re-review (Codex Finding 1) — the broker resolved a parked permission with `deny`.
 * The driver poisons its async-iterable queue with this error so the orchestrator can apply
 * `transition(turn, {type: 'permission_decision', decision: 'deny'})` and persist the turn as
 * `failed` (per the state machine). Without this signal, an ACP server that handles deny by
 * emitting a polite refusal and ending normally would persist the turn as `completed`.
 */
export class PermissionDeniedError extends ChannelError {
  public constructor(public readonly turnId: string, public readonly permissionRequestId: string) {
    super('PERMISSION_DENIED', `Turn "${turnId}" denied permission "${permissionRequestId}".`)
  }
}
