/**
 * Centralized parser types for both raw and clean parsers
 * Single source of truth for all parser-related data structures
 *
 * Organization:
 * 1. TARGET LAYER - Final normalized output types (CleanSession, CleanMessage, etc.)
 * 2. RAW LAYER - Types used by raw parsers, organized by IDE
 * 3. CLEAN LAYER - Helper types for clean parsers
 */

// ============================================================================
// TARGET LAYER - Final Normalized Output Types
// ============================================================================

/**
 * Workspace information type
 * Used across raw parsers for workspace validation and identification
 */
export type WorkspaceInfo = {
  isValid: boolean
  name: string
  path: string
  reason?: string
  type: 'claude' | 'codex' | 'copilot' | 'cursor'
}

/**
 * Session type union for all supported IDEs
 */
export type SessionType = 'Claude' | 'Codex' | 'Copilot' | 'Cursor'

/**
 * Content block types - Unified representation across all IDEs
 */
export type TextContentBlock = {
  text: string
  type: 'text'
}

export type ThinkingContentBlock = {
  thinking: string
  type: 'thinking'
}

export type ToolUseContentBlock = {
  id: string
  input: Record<string, unknown>
  name: string
  tool_use_id?: string
  type: 'tool_use'
}

export type ToolResultContentBlock = {
  content: Record<string, unknown> | string
  tool_use_id: string
  type: 'tool_result'
}

export type ContentBlock =
  | Record<string, unknown>
  | TextContentBlock
  | ThinkingContentBlock
  | ToolResultContentBlock
  | ToolUseContentBlock

/**
 * Clean message type - Normalized message format across all IDEs
 */
export type CleanMessage = {
  [key: string]: unknown
  attachments?: string[]
  content: ContentBlock[]
  timestamp: string
  turn_id?: number
  type: 'assistant' | 'user'
}

/**
 * Clean session type - Final normalized session format
 */
export type CleanSession = {
  id: string
  messages: CleanMessage[]
  metadata?: unknown
  timestamp: number
  title: string
  type: SessionType
  workspacePaths: string[]
}

// ============================================================================
// RAW LAYER - Types Used by Raw Parsers
// ============================================================================

// ----------------------------------------------------------------------------
// Claude Raw Types
// ----------------------------------------------------------------------------

export type RawClaudeTranscriptEntry = {
  content?: string
  cwd?: string
  message?: {
    content: (ContentBlock | string)[]
    role: 'assistant' | 'user'
    usage?: {
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
      input_tokens?: number
      output_tokens?: number
    }
  }
  sessionId?: string
  timestamp?: string
  type: 'assistant' | 'summary' | 'system' | 'user'
  uuid?: string
}

export type RawClaudeTokenUsage = {
  cacheTokens?: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export type RawClaudeWorkspaceMetadata = {
  path: string
  repository?: {
    name: string
    url?: string
  }
}

export type RawClaudeSessionMetadata = {
  assistantMessageCount: number
  cwd?: string
  duration: number
  endedAt?: string
  messageCount: number
  sessionId: string
  startedAt: string
  tokenUsage: RawClaudeTokenUsage
  userMessageCount: number
  workspace: RawClaudeWorkspaceMetadata
}

export type RawClaudeRawMessage = {
  content: ContentBlock[] | string
  cwd?: string
  timestamp: string
  tokens?: {
    input: number
    output: number
  }
  type: 'assistant' | 'system' | 'user'
}

export type RawClaudeRawSession = {
  id: string
  messages: RawClaudeRawMessage[]
  metadata: RawClaudeSessionMetadata
  timestamp: number
  title: string
}

export type RawClaudeTimestamps = {
  endedAt?: string
  startedAt: string
}

// ----------------------------------------------------------------------------
// Codex Raw Types
// ----------------------------------------------------------------------------

export type RawCodexTokenUsage = {
  cached_input_tokens?: number
  input_tokens?: number
  output_tokens?: number
}

export type RawCodexEventPayload = {
  info?: { total_token_usage: RawCodexTokenUsage }
  text?: string
  type: 'agent_reasoning' | 'token_count'
}

export type RawCodexResponsePayload = {
  arguments?: Record<string, unknown> | string
  content?: RawCodexContentBlock[] | string
  name?: string
  output?: unknown
  role?: 'assistant' | 'user'
  summary?: Array<{ text: string; type: string; }>
  type: 'function_call' | 'function_call_output' | 'message' | 'reasoning'
}

export type RawCodexSessionMetaPayload = {
  cli_version?: string
  cwd?: string
  git?: { repository_url?: string }
  model_provider?: string
  originator?: string
  source?: string
  timestamp?: string
}

export type RawCodexSessionMeta = {
  cli_version?: string
  cwd?: string
  git?: { repository_url?: string }
  model_provider?: string
  originator?: string
  source?: string
  timestamp?: string
}

export type RawCodexTranscriptEntry = {
  payload?: Record<string, unknown>
  timestamp?: string
  type: 'event_msg' | 'response_item' | 'session_meta' | string
}

export type RawCodexContentBlock = {
  input?: Record<string, unknown>
  name?: string
  output?: unknown
  text?: string
  type: 'input_text' | 'output_text' | 'tool_use'
}

export type RawCodexSessionMetadata = {
  assistantMessageCount: number
  cliVersion?: string
  duration: number
  endedAt?: string
  messageCount: number
  model?: string
  modelProvider?: string
  originator?: string
  sessionId: string
  source?: string
  startedAt: string
  tokenUsage: RawClaudeTokenUsage
  userMessageCount: number
  workspace: RawClaudeWorkspaceMetadata
}

export type RawCodexRawEntry = {
  payload: Record<string, unknown>
  timestamp: number
  type: 'event_msg' | 'response_item' | 'session_meta' | 'turn_context'
}

export type RawCodexRawMessage = {
  content: ContentBlock[] | string | undefined
  reasoning?: string
  timestamp: string
  tokens?: {
    input: number
    output: number
  }
  type: 'assistant' | 'user'
}

export type RawCodexRawSession = {
  id: string
  messages: RawCodexRawMessage[]
  metadata: RawCodexSessionMetadata
  rawEntries: RawCodexRawEntry[]
  timestamp: number
  title: string
}

// ----------------------------------------------------------------------------
// Copilot Raw Types
// ----------------------------------------------------------------------------

export type RawCopilotDatabaseRow = {
  value?: string
}

export type RawCopilotResponseBlock = {
  [key: string]: unknown
  kind?: string
  text?: string
}

export type RawCopilotVariableData = {
  variables?: Array<{ kind?: string; name: string; }>
}

export type RawCopilotContentBlock = {
  [key: string]: RawCopilotContentBlock | RawCopilotContentBlock[] | string | undefined
  kind?: string
  text?: string
}

export type RawCopilotRequestData = {
  message?: { text?: string }
  requestId?: string
  response?: Record<string, unknown> | Record<string, unknown>[]
  responseId?: string
  result?: { [key: string]: unknown; timings?: { totalElapsed?: number }; }
  variableData?: RawCopilotVariableData
}

export type RawCopilotSessionFileData = {
  [key: string]: unknown
  baseUri?: { path?: string }
  initialLocation?: string
  requesterUsername?: string
  requests?: RawCopilotRequestData[]
  responderUsername?: string
}

export type RawCopilotSessionMetadata = {
  initialLocation?: string
  messageCount: number
  requestCount: number
  requesterUsername: string
  responderUsername: string
  sessionId: string
  totalDuration: number
  workspace: {
    path: string
  }
}

export type RawCopilotResponseItem = {
  [key: string]: unknown
  invocationMessage?: {
    value: unknown
  }
  kind?: string
  output?: unknown
  toolCallId?: string
  toolId?: string
  value?: string
}

export type RawCopilotToolCallRound = {
  toolCalls: Array<{
    arguments?: Record<string, unknown> | string
    id: string
  }>
}

export type RawCopilotParsedRequest = {
  message?: {
    text?: string
  }
  requestId: string
  response?: RawCopilotResponseItem[]
  responseId: string
  result?: {
    metadata?: {
      toolCallResults?: Record<string, unknown>
      toolCallRounds?: RawCopilotToolCallRound[]
    }
    timings?: {
      totalElapsed?: number
    }
  }
  variableData?: {
    variables?: Array<{
      kind?: string
      name: string
    }>
  }
}

export type RawCopilotRawMessage = {
  attachments?: string[]
  content: ContentBlock[] | string
  type: 'assistant' | 'user'
}

export type RawCopilotRawSession = {
  id: string
  messages: RawCopilotRawMessage[]
  metadata: RawCopilotSessionMetadata
  requests?: RawCopilotParsedRequest[]
  timestamp: number
  title: string
  workspaceHash: string
  workspacePath?: string | string[]
}

// ----------------------------------------------------------------------------
// Cursor Raw Types
// ----------------------------------------------------------------------------

export type RawCursorComposerData = {
  [key: string]: unknown
  composerId: string
}

export type RawCursorDatabaseQueryResult = {
  [key: string]: unknown
  value: Buffer | string
}

export type RawCursorRule = {
  [key: string]: unknown
  content?: string
  id?: string
  name?: string
}

export type RawCursorTerminalFile = {
  [key: string]: unknown
  name: string
  path: string
}

export type RawCursorKnowledgeItem = {
  [key: string]: unknown
  content?: string
  id?: string
  title?: string
}

export type RawCursorTodoItem = {
  [key: string]: unknown
  completed?: boolean
  id?: string
  text?: string
}

export type RawCursorDeletedFile = {
  [key: string]: unknown
  deletedAt?: number
  path: string
}

export type RawCursorAttachedFolderListDirResult = {
  [key: string]: unknown
  contents: string[]
  path: string
}

export type RawCursorBubbleRaw = {
  [key: string]: unknown
  attachedFoldersListDirResults?: RawCursorAttachedFolderListDirResult[]
  codeBlocks?: Record<string, string>
  consoleLogs?: string[]
  cursorRules?: RawCursorRule[]
  text?: string
  timestamp?: number
  toolFormerData?: Record<string, unknown>
}

export type RawCursorToolResult = {
  additionalData?: Record<string, unknown>
  modelCallId: string
  name: string
  params: Record<string, unknown> | string
  rawArgs: Record<string, unknown> | string
  result: Record<string, unknown> | string
  status: string
  tool: number
  toolCallId: string
  toolIndex: number
}

export type RawCursorContextInfo = {
  attachedFolders?: Record<string, unknown>[]
  attachedFoldersListDirResults?: RawCursorAttachedFolderListDirResult[]
  cursorRules?: RawCursorRule[]
  deletedFiles?: RawCursorDeletedFile[]
  gitStatus?: string
  knowledgeItems?: RawCursorKnowledgeItem[]
  terminalFiles?: RawCursorTerminalFile[]
  todos?: RawCursorTodoItem[]
}

export type RawCursorCodeDiff = {
  [key: string]: unknown
  diffId: string
  filePath?: string
  newModelDiffWrtV0?: Array<unknown>
  originalModelDiffWrtV0?: Array<unknown>
}

export type RawCursorFileCheckpoint = {
  activeInlineDiffs: string[]
  files: string[]
  inlineDiffNewlyCreatedResources?: {
    files: string[]
    folders: string[]
  }
  newlyCreatedFolders: string[]
  nonExistentFiles: string[]
}

export type RawCursorMessageRequestContext = {
  [key: string]: unknown
  attachedFoldersListDirResults?: RawCursorAttachedFolderListDirResult[]
  bubbleId?: string
  contextId?: string
  cursorRules?: RawCursorRule[]
  deletedFiles?: RawCursorDeletedFile[]
  gitStatusRaw?: string
  knowledgeItems?: RawCursorKnowledgeItem[]
  terminalFiles?: RawCursorTerminalFile[]
  todos?: RawCursorTodoItem[]
}

export type RawCursorEnhancedChatBubble = {
  codeBlocks?: Record<string, string>
  codeDiffs?: RawCursorCodeDiff[]
  consoleLogs?: string[]
  context?: RawCursorContextInfo
  fileCheckpoint?: RawCursorFileCheckpoint
  text: string
  timestamp: number
  toolResults?: RawCursorToolResult
  type: 'ai' | 'user'
}

export type RawCursorBubbleLoadResult = {
  bubbleMap: Record<string, RawCursorBubbleRaw>
  bubbleWorkspaceMap: Record<string, string>
  uniqueWorkspaces: Set<string>
}

export type RawCursorBubbleProcessResult = {
  bubbles: RawCursorEnhancedChatBubble[]
  usedWorkspaces: Set<string>
}

export type RawCursorConversation = {
  bubbles: RawCursorEnhancedChatBubble[]
  composerId: string
  name: string
  timestamp: number
  workspacePath?: string | string[]
}

export type RawCursorParseResult = {
  errors?: Array<{
    error: string
    path: string
  }>
  totalBubbles: number
  totalSessions: number
  totalToolInvocations: number
  totalWorkspaces: number
  workspaces: Array<{
    metadata: {
      totalBubbles: number
      totalSessions: number
      totalToolInvocations: number
    }
    sessions: RawCursorRawSession[]
    workspaceHash: string
    workspacePath: string | string[]
  }>
}

export type CursorToolResult = {
  content?: unknown
  name: string
  output?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  toolCallId: string
}

export type CursorCodeBlock = {
  content: string
  languageId?: string
}

export type CursorContextInfo = {
  [key: string]: unknown
  attachedFoldersListDirResults?: unknown[]
  cursorRules?: unknown[]
  deletedFiles?: unknown[]
  gitStatus?: string
  knowledgeItems?: unknown[]
  terminalFiles?: unknown[]
  todos?: unknown[]
}

export type CursorBubble = {
  codeBlocks?: CursorCodeBlock[]
  context?: CursorContextInfo
  text: string
  timestamp: number
  toolResults?: CursorToolResult
  type: 'ai' | 'user'
}

export type RawCursorSessionMetadata = {
  aiBubbles: number
  bubbleCount: number
  codeBlockLanguages: string[]
  createdAt?: number
  hasCodeBlocks: boolean
  lastUpdatedAt?: number
  toolInvocations: number
  userBubbles: number
  workspacePath?: string
}

export type RawCursorRawSession = {
  bubbles: CursorBubble[]
  id: string
  metadata?: RawCursorSessionMetadata
  timestamp: number
  title: string
  workspaceHash: string
  workspacePath: string | string[]
}

// ----------------------------------------------------------------------------
// Raw Session Union Type
// ----------------------------------------------------------------------------

/**
 * Union type for all raw sessions from different IDEs
 */
export type RawSession = RawClaudeRawSession | RawCodexRawSession | RawCopilotRawSession | RawCursorRawSession

// ============================================================================
// CLEAN LAYER - Helper Types for Clean Parsers
// ============================================================================

// ----------------------------------------------------------------------------
// Clean Claude Helper Types
// ----------------------------------------------------------------------------

export type CleanClaudeSessionLoadResult = {
  agentSessions: Map<string, RawClaudeRawSession>
  allSessions: Map<string, RawClaudeRawSession>
}

// ----------------------------------------------------------------------------
// Clean Codex Helper Types
// ----------------------------------------------------------------------------

// (Currently no Codex-specific clean helper types)

// ----------------------------------------------------------------------------
// Clean Copilot Helper Types
// ----------------------------------------------------------------------------

export type CleanCopilotProcessResult = {
  invalid: number
  total: number
  valid: number
}

// ----------------------------------------------------------------------------
// Clean Cursor Helper Types
// ----------------------------------------------------------------------------

export type CleanCursorToolUseBlock = {
  id: string
  input?: Record<string, unknown>
  name: string
  output?: Record<string, unknown> | string
  tool_use_id: string
  type: 'tool_use'
}

export type CleanCursorToolResultBlock = {
  content: Record<string, unknown> | string
  type: 'tool_result'
}
