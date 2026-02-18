/**
 * Status of a curation process.
 * Emitted after curate execution completes to enable status tracking.
 */
export interface CurationStatus {
  /** Timestamp when curation completed (ISO 8601) */
  completedAt: string
  /** Error message if failed */
  error?: string
  /** Overall status */
  status: 'failed' | 'partial' | 'success'
  /** Summary from tools.curate() result */
  summary: {
    added: number
    deleted: number
    failed: number
    merged: number
    updated: number
  }
  /** Unique task ID for this curation run */
  taskId: string
  /** Verification results — did the files actually materialize? */
  verification: {
    checked: number
    confirmed: number
    missing: string[]
  }
}
