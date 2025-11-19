/**
 * Represents a parsed interaction between a user and a coding agent.
 * This entity captures valuable interaction data from coding agent logs
 * (Claude Code, GitHub Copilot, Cursor, Codex, etc.).
 */
export type ParsedInteraction = {
  /** Agent's response  */
  readonly agentResponse: string

  /** Type of coding agent (e.g., 'claude-code', 'copilot', 'cursor') */
  readonly agentType: string

  /** Additional metadata about the interaction */
  readonly metadata?: Record<string, unknown>

  /** Timestamp of the interaction */
  readonly timestamp: number

  /** Tool calls made by the agent, if any */
  readonly toolCalls?: ToolCall[]

  /** User's message or prompt */
  readonly userMessage: string
}

/**
 * Represents a tool call made by a coding agent.
 */
type ToolCall = {
  /** Tool input/parameters */
  readonly input: Record<string, unknown>

  /** Name of the tool */
  readonly name: string

  /** Tool output/result, if available */
  readonly output?: unknown
}

type CreateParsedInteractionParams = {
  agentResponse: string
  agentType: string
  metadata?: Record<string, unknown>
  timestamp: number
  toolCalls?: ToolCall[]
  userMessage: string
}

/**
 * Factory function to create a ParsedInteraction with validation.
 */
export const createParsedInteraction = (params: CreateParsedInteractionParams): ParsedInteraction => {
  if (params.agentType.trim() === '') {
    throw new Error('agentType is required')
  }

  if (params.userMessage.trim() === '') {
    throw new Error('userMessage is required')
  }

  if (params.agentResponse.trim() === '') {
    throw new Error('agentResponse is required')
  }

  if (params.timestamp <= 0) {
    throw new Error('timestamp must be a positive number')
  }

  return {
    agentResponse: params.agentResponse,
    agentType: params.agentType,
    metadata: params.metadata,
    timestamp: params.timestamp,
    toolCalls: params.toolCalls,
    userMessage: params.userMessage,
  }
}
