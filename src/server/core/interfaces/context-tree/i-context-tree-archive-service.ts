import type {ICipherAgent} from '../../../../agent/core/interfaces/i-cipher-agent.js'
import type {ArchiveResult, DrillDownResult} from '../../domain/knowledge/summary-types.js'

/**
 * Service for archiving and restoring context tree entries.
 *
 * Archives low-importance entries into _archived/ with:
 * - .stub.md: searchable ghost cue (~220 tokens)
 * - .full.md: lossless preserved original content
 */
export interface IContextTreeArchiveService {
  /**
   * Archive a context entry: write .full.md + .stub.md, delete original.
   * Uses LLM to generate ghost cue with deterministic fallback.
   */
  archiveEntry(relativePath: string, agent: ICipherAgent, directory?: string): Promise<ArchiveResult>

  /**
   * Drill down into an archived entry: read .full.md via stub's points_to.
   * No LLM call — purely file-based lookup.
   */
  drillDown(stubPath: string, directory?: string): Promise<DrillDownResult>

  /**
   * Find entries that are candidates for archiving.
   * Returns paths where importance < ARCHIVE_IMPORTANCE_THRESHOLD and maturity === 'draft'.
   */
  findArchiveCandidates(directory?: string): Promise<string[]>

  /**
   * Restore an archived entry: write .full.md content to original_path, delete stub + full.
   */
  restoreEntry(stubPath: string, directory?: string): Promise<string>
}
