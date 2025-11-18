/**
 * Centralized parser types for both raw and clean parsers
 * Single source of truth for all parser-related data structures
 */

// ============================================================================
// WORKSPACE TYPES
// ============================================================================

export type WorkspaceInfo = {
  isValid: boolean
  name: string
  path: string
  reason?: string
  type: 'claude' | 'codex' | 'copilot' | 'cursor'
}

export type SessionType = 'Claude' | 'Codex' | 'Copilot' | 'Cursor'

// ============================================================================
// CONTENT BLOCK TYPES (Unified)
// ============================================================================

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

// ============================================================================
// CLEAN MESSAGE TYPES (Normalized)
// ============================================================================

export type CleanMessage = {
  [key: string]: unknown
  attachments?: string[]
  content: ContentBlock[]
  timestamp: string
  turn_id?: number
  type: 'assistant' | 'user'
}

// ============================================================================
// RAW SESSION TYPES (from Raw Parsers)
// ============================================================================

// Claude Raw Session - Message and Content Types
export type ClaudeTranscriptEntry = {
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

export type ClaudeTokenUsage = {
  cacheTokens?: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export type ClaudeWorkspaceMetadata = {
  path: string
  repository?: {
    name: string
    url?: string
  }
}

export type ClaudeSessionMetadata = {
  assistantMessageCount: number
  cwd?: string
  duration: number
  endedAt?: string
  messageCount: number
  sessionId: string
  startedAt: string
  tokenUsage: ClaudeTokenUsage
  userMessageCount: number
  workspace: ClaudeWorkspaceMetadata
}

export type ClaudeRawMessage = {
  content: ContentBlock[] | string
  cwd?: string
  timestamp: string
  tokens?: {
    input: number
    output: number
  }
  type: 'assistant' | 'system' | 'user'
}

export type ClaudeRawSession = {
  id: string
  messages: ClaudeRawMessage[]
  metadata: ClaudeSessionMetadata
  timestamp: number
  title: string
}

// Codex Raw Session - Helper Types

export type CodexTokenUsage = {
  cached_input_tokens?: number
  input_tokens?: number
  output_tokens?: number
}

export type CodexEventPayload = {
  info?: { total_token_usage: CodexTokenUsage }
  text?: string
  type: 'agent_reasoning' | 'token_count'
}

export type CodexResponsePayload = {
  arguments?: Record<string, unknown> | string
  content?: CodexContentBlock[] | string
  name?: string
  output?: unknown
  role?: 'assistant' | 'user'
  summary?: Array<{ text: string; type: string; }>
  type: 'function_call' | 'function_call_output' | 'message' | 'reasoning'
}

export type CodexSessionMetaPayload = {
  cli_version?: string
  cwd?: string
  git?: { repository_url?: string }
  model_provider?: string
  originator?: string
  source?: string
  timestamp?: string
}

export type CodexSessionMeta = {
  cli_version?: string
  cwd?: string
  git?: { repository_url?: string }
  model_provider?: string
  originator?: string
  source?: string
  timestamp?: string
}

export type CodexTranscriptEntry = {
  payload?: Record<string, unknown>
  timestamp?: string
  type: 'event_msg' | 'response_item' | 'session_meta' | string
}

export type CodexContentBlock = {
  input?: Record<string, unknown>
  name?: string
  output?: unknown
  text?: string
  type: 'input_text' | 'output_text' | 'tool_use'
}

// Codex Raw Session
export type CodexSessionMetadata = {
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
  tokenUsage: ClaudeTokenUsage
  userMessageCount: number
  workspace: ClaudeWorkspaceMetadata
}

export type CodexRawEntry = {
  payload: Record<string, unknown>
  timestamp: number
  type: 'event_msg' | 'response_item' | 'session_meta' | 'turn_context'
}

export type CodexRawMessage = {
  content: ContentBlock[] | string | undefined
  reasoning?: string
  timestamp: string
  tokens?: {
    input: number
    output: number
  }
  type: 'assistant' | 'user'
}

export type CodexRawSession = {
  id: string
  messages: CodexRawMessage[]
  metadata: CodexSessionMetadata
  rawEntries: CodexRawEntry[]
  timestamp: number
  title: string
}

// Copilot Raw Session - Helper Types
// Basic value types
export type DatabaseRow = {
  value?: string
}

// Response block type used internally
export type CopilotResponseBlock = {
  [key: string]: unknown
  kind?: string
  text?: string
}

export type CopilotVariableData = {
  variables?: Array<{ kind?: string; name: string; }>
}

export type CopilotContentBlock = {
  [key: string]: CopilotContentBlock | CopilotContentBlock[] | string | undefined
  kind?: string
  text?: string
}

export type CopilotRequestData = {
  message?: { text?: string }
  requestId?: string
  response?: Record<string, unknown> | Record<string, unknown>[]
  responseId?: string
  result?: { [key: string]: unknown; timings?: { totalElapsed?: number }; }
  variableData?: CopilotVariableData
}

export type CopilotSessionFileData = {
  [key: string]: unknown
  baseUri?: { path?: string }
  initialLocation?: string
  requesterUsername?: string
  requests?: CopilotRequestData[]
  responderUsername?: string
}

// Copilot Raw Session
export type CopilotSessionMetadata = {
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

export type CopilotResponseItem = {
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

export type CopilotToolCallRound = {
  toolCalls: Array<{
    arguments?: Record<string, unknown> | string
    id: string
  }>
}

export type CopilotParsedRequest = {
  message?: {
    text?: string
  }
  requestId: string
  response?: CopilotResponseItem[]
  responseId: string
  result?: {
    metadata?: {
      toolCallResults?: Record<string, unknown>
      toolCallRounds?: CopilotToolCallRound[]
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

export type CopilotRawMessage = {
  attachments?: string[]
  content: ContentBlock[] | string
  type: 'assistant' | 'user'
}

export type CopilotRawSession = {
  id: string
  messages: CopilotRawMessage[]
  metadata: CopilotSessionMetadata
  requests?: CopilotParsedRequest[]
  timestamp: number
  title: string
  workspaceHash: string
  workspacePath?: string | string[]
}

// Cursor Raw Session - Helper Types
export type ComposerData = {
  [key: string]: unknown
  composerId: string
}

export type DatabaseQueryResult = {
  [key: string]: unknown
  value: Buffer | string
}

export type CursorRule = {
  [key: string]: unknown
  content?: string
  id?: string
  name?: string
}

export type TerminalFile = {
  [key: string]: unknown
  name: string
  path: string
}

export type KnowledgeItem = {
  [key: string]: unknown
  content?: string
  id?: string
  title?: string
}

export type TodoItem = {
  [key: string]: unknown
  completed?: boolean
  id?: string
  text?: string
}

export type DeletedFile = {
  [key: string]: unknown
  deletedAt?: number
  path: string
}

export type AttachedFolderListDirResult = {
  [key: string]: unknown
  contents: string[]
  path: string
}

export type CursorBubbleRaw = {
  [key: string]: unknown
  attachedFoldersListDirResults?: AttachedFolderListDirResult[]
  codeBlocks?: Record<string, string>
  consoleLogs?: string[]
  cursorRules?: CursorRule[]
  text?: string
  timestamp?: number
  toolFormerData?: Record<string, unknown>
}

export type ToolResult = {
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

export type ContextInfo = {
  attachedFolders?: Record<string, unknown>[]
  attachedFoldersListDirResults?: AttachedFolderListDirResult[]
  cursorRules?: CursorRule[]
  deletedFiles?: DeletedFile[]
  gitStatus?: string
  knowledgeItems?: KnowledgeItem[]
  terminalFiles?: TerminalFile[]
  todos?: TodoItem[]
}

export type CodeDiff = {
  [key: string]: unknown
  diffId: string
  filePath?: string
  newModelDiffWrtV0?: Array<unknown>
  originalModelDiffWrtV0?: Array<unknown>
}

export type FileCheckpoint = {
  activeInlineDiffs: string[]
  files: string[]
  inlineDiffNewlyCreatedResources?: {
    files: string[]
    folders: string[]
  }
  newlyCreatedFolders: string[]
  nonExistentFiles: string[]
}

export type MessageRequestContext = {
  [key: string]: unknown
  attachedFoldersListDirResults?: AttachedFolderListDirResult[]
  bubbleId?: string
  contextId?: string
  cursorRules?: CursorRule[]
  deletedFiles?: DeletedFile[]
  gitStatusRaw?: string
  knowledgeItems?: KnowledgeItem[]
  terminalFiles?: TerminalFile[]
  todos?: TodoItem[]
}

export type EnhancedChatBubble = {
  codeBlocks?: Record<string, string>
  codeDiffs?: CodeDiff[]
  consoleLogs?: string[]
  context?: ContextInfo
  fileCheckpoint?: FileCheckpoint
  text: string
  timestamp: number
  toolResults?: ToolResult
  type: 'ai' | 'user'
}

export type CursorParseResult = {
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
    sessions: CursorRawSession[]
    workspaceHash: string
    workspacePath: string | string[]
  }>
}

// Cursor Raw Session
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

export type CursorSessionMetadata = {
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

export type CursorRawSession = {
  bubbles: CursorBubble[]
  id: string
  metadata?: CursorSessionMetadata
  timestamp: number
  title: string
  workspaceHash: string
  workspacePath: string | string[]
}

// Union type for all raw sessions
export type RawSession = ClaudeRawSession | CodexRawSession | CopilotRawSession | CursorRawSession

// ============================================================================
// CLEAN SESSION TYPES (Normalized Output)
// ============================================================================

export type CleanSession = {
  id: string
  messages: CleanMessage[]
  metadata?: unknown
  timestamp: number
  title: string
  type: SessionType
  workspacePaths: string[]
}
