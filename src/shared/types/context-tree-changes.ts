/**
 * Represents changes detected between current state and snapshot.
 */
export interface ContextTreeChanges {
  /** Files that exist now but not in snapshot */
  added: string[]
  /** Files that exist in snapshot but not now */
  deleted: string[]
  /** Files with different hash than snapshot */
  modified: string[]
}
