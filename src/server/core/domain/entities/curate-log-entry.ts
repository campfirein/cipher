export type CurateLogOperation = {
  filePath?: string
  message?: string
  path: string
  status: 'failed' | 'success'
  type: 'ADD' | 'DELETE' | 'MERGE' | 'UPDATE' | 'UPSERT'
}

export type CurateLogSummary = {
  added: number
  deleted: number
  failed: number
  merged: number
  updated: number
}

type CurateLogBase = {
  id: string
  input: {
    context?: string
    files?: string[]
    folders?: string[]
  }
  operations: CurateLogOperation[]
  startedAt: number
  summary: CurateLogSummary
  taskId: string
}

export type CurateLogEntry =
  | (CurateLogBase & {completedAt: number; error: string; status: 'error'})
  | (CurateLogBase & {completedAt: number; response?: string; status: 'completed'})
  | (CurateLogBase & {status: 'processing'})
