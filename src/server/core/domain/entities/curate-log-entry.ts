export type CurateLogOperation = {
  confidence?: 'high' | 'low'
  filePath?: string
  additionalFilePaths?: string[]
  impact?: 'high' | 'low' | 'medium'
  message?: string
  needsReview?: boolean
  path: string
  reason?: string
  /** Local review status. Set to 'pending' when needsReview=true; updated to 'approved'/'rejected' by the review UI. */
  reviewStatus?: 'approved' | 'pending' | 'rejected'
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
  | (CurateLogBase & {completedAt: number; status: 'cancelled'})
  | (CurateLogBase & {status: 'processing'})
