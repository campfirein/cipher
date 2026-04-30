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
