/**
 * Shared type definitions for tool results in tests.
 * These types match the actual return types from tool implementations.
 */

// File System Tool Results
export type ReadFileResult = {
  content: string
  encoding: string
  lines: number
  size: number
  truncated: boolean
}

export type WriteFileResult = {
  bytesWritten: number
  path: string
  success: boolean
}

export type EditFileResult = {
  bytesWritten: number
  path: string
  replacements: number
  success: boolean
}

export type GlobFileEntry = {
  modified: string
  path: string
  size: number
}

export type GlobFilesResult = {
  files: GlobFileEntry[]
  totalFound: number
  truncated: boolean
}

export type GrepMatch = {
  context?: {
    after: string[]
    before: string[]
  }
  file: string
  line: string
  lineNumber: number
}

export type GrepContentResult = {
  filesSearched: number
  matches: GrepMatch[]
  totalMatches: number
  truncated: boolean
}

// Process Tool Results
export type BashExecForegroundResult = {
  duration: number
  exitCode: number
  stderr: string
  stdout: string
}

export type BashExecBackgroundResult = {
  command: string
  description?: string
  message: string
  pid: number
  processId: string
  startedAt: string
}

export type BashOutputResult = {
  duration?: number
  exitCode?: number
  processId: string
  status: 'completed' | 'failed' | 'running'
  stderr: string
  stdout: string
}

export type KillProcessResult = {
  message: string
  processId: string
  success: boolean
}

