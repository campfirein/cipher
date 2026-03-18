import {join, resolve} from 'node:path'

import {
  BRV_DIR,
  CONTEXT_TREE_DIR,
  EXPERIENCE_DEAD_ENDS_FILE,
  EXPERIENCE_DIR,
  EXPERIENCE_HINTS_FILE,
  EXPERIENCE_LESSONS_FILE,
  EXPERIENCE_META_FILE,
  EXPERIENCE_PLAYBOOK_FILE,
} from '../../constants.js'
import {DirectoryManager} from '../../core/domain/knowledge/directory-manager.js'
import {parseFrontmatterScoring, updateScoringInContent} from '../../core/domain/knowledge/markdown-writer.js'
import {determineTier, recordCurateUpdate} from '../../core/domain/knowledge/memory-scoring.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExperienceMeta {
  curationCount: number
  lastConsolidatedAt: string
}

// ---------------------------------------------------------------------------
// Section header map — locked to seed templates
// ---------------------------------------------------------------------------

/** Maps each experience filename to its expected section header. */
export const EXPERIENCE_SECTIONS: Record<string, string> = {
  [EXPERIENCE_DEAD_ENDS_FILE]: 'Dead Ends',
  [EXPERIENCE_HINTS_FILE]: 'Hints',
  [EXPERIENCE_LESSONS_FILE]: 'Facts',
  [EXPERIENCE_PLAYBOOK_FILE]: 'Strategies',
}

// ---------------------------------------------------------------------------
// Seed template builder
// ---------------------------------------------------------------------------

function buildSeedFile(title: string, tags: string[], keywords: string[], section: string): string {
  const iso = new Date().toISOString()
  return [
    '---',
    `title: "${title}"`,
    `tags: [${tags.map((t) => `"${t}"`).join(', ')}]`,
    `keywords: [${keywords.map((k) => `"${k}"`).join(', ')}]`,
    'importance: 70',
    'recency: 1',
    'maturity: validated',
    'accessCount: 0',
    'updateCount: 0',
    `createdAt: "${iso}"`,
    `updatedAt: "${iso}"`,
    '---',
    '',
    `## ${section}`,
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Append bullets to the end of the given section.
 * Preserves chronological order across repeated appends so later consolidation
 * reads bullets in the same order they were originally added.
 * Throws if the section header is not found — missing header indicates
 * corruption or a bad consolidation output, not a graceful no-op.
 */
function appendBulletsToSection(content: string, sectionHeader: string, bullets: string[]): string {
  const marker = `\n## ${sectionHeader}\n`
  const idx = content.indexOf(marker)
  if (idx === -1) {
    throw new Error(
      `Section "## ${sectionHeader}" not found in experience file — file may be corrupted or missing the expected template`,
    )
  }

  const sectionStart = idx + marker.length
  const nextHeading = content.indexOf('\n## ', sectionStart)
  const insertAt = nextHeading === -1 ? content.length : nextHeading
  const newLines = bullets.map((b) => `- ${b}`).join('\n') + '\n'
  return content.slice(0, insertAt) + newLines + content.slice(insertAt)
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

// ---------------------------------------------------------------------------
// ExperienceStore
// ---------------------------------------------------------------------------

/**
 * Manages read/write operations for the experience domain files under
 * .brv/context-tree/experience/.
 *
 * Responsibilities:
 * - Idempotent seeding of the experience directory
 * - Batch bullet appends (one recordCurateUpdate per file write)
 * - Meta persistence via _meta.json (local-only, not synced)
 * - Raw file access for consolidation
 */
export class ExperienceStore {
  private readonly experienceDir: string

  constructor(baseDirectory?: string) {
    const base = baseDirectory ?? process.cwd()
    this.experienceDir = resolve(base, BRV_DIR, CONTEXT_TREE_DIR, EXPERIENCE_DIR)
  }

  /**
   * Append multiple bullets to a file's section in a single atomic write.
   * Applies recordCurateUpdate() + determineTier() once per call — matching
   * the one-write-per-file pattern used in curate-tool.ts.
   *
   * @throws if the section header is missing (corruption guard)
   */
  async appendBulkToFile(filename: string, section: string, bullets: string[]): Promise<void> {
    if (bullets.length === 0) return

    const filePath = join(this.experienceDir, filename)
    const content = await DirectoryManager.readFile(filePath)

    const existingScoring = parseFrontmatterScoring(content)
    if (!existingScoring) {
      throw new Error(
        `Experience file "${filename}" is missing frontmatter — file may be corrupted`,
      )
    }

    const updated = recordCurateUpdate(existingScoring)
    const tier = determineTier(
      updated.importance ?? 50,
      (updated.maturity ?? 'draft') as 'core' | 'draft' | 'validated',
    )
    const finalScoring = {...updated, maturity: tier}

    // Throws if section header not found — caller owns fail-open behavior
    const withBullets = appendBulletsToSection(content, section, bullets)
    const final = updateScoringInContent(withBullets, finalScoring)

    await DirectoryManager.writeFileAtomic(filePath, final)
  }

  /**
   * Ensure the experience directory and all seed files exist.
   * Idempotent — safe to call on every curation.
   *
   * @returns true if any file was newly created, false if all already existed
   */
  async ensureInitialized(): Promise<boolean> {
    await DirectoryManager.createOrUpdateDomain(this.experienceDir)

    const seeds: Array<{content: string; file: string}> = [
      {
        content: buildSeedFile(
          'Experience: Lessons',
          ['experience', 'lessons'],
          ['lesson', 'learned', 'pattern', 'insight', 'discovered'],
          'Facts',
        ),
        file: EXPERIENCE_LESSONS_FILE,
      },
      {
        content: buildSeedFile(
          'Experience: Hints',
          ['experience', 'hints'],
          ['hint', 'tip', 'note', 'remember', 'forward'],
          'Hints',
        ),
        file: EXPERIENCE_HINTS_FILE,
      },
      {
        content: buildSeedFile(
          'Experience: Dead Ends',
          ['experience', 'dead-ends'],
          ['dead-end', 'failed', 'avoid', 'blocked'],
          'Dead Ends',
        ),
        file: EXPERIENCE_DEAD_ENDS_FILE,
      },
      {
        content: buildSeedFile(
          'Experience: Playbook',
          ['experience', 'playbook'],
          ['strategy', 'pattern', 'approach', 'best-practice'],
          'Strategies',
        ),
        file: EXPERIENCE_PLAYBOOK_FILE,
      },
    ]

    const seedResults = await Promise.all(
      seeds.map(async ({content, file}) => {
        const filePath = join(this.experienceDir, file)
        const exists = await DirectoryManager.fileExists(filePath)
        if (!exists) {
          await DirectoryManager.writeFileAtomic(filePath, content)
          return true
        }

        return false
      }),
    )

    let anyCreated = seedResults.some(Boolean)

    // Seed _meta.json (plain JSON, not .md — never synced or indexed)
    const metaPath = join(this.experienceDir, EXPERIENCE_META_FILE)
    const metaExists = await DirectoryManager.fileExists(metaPath)
    if (!metaExists) {
      const meta: ExperienceMeta = {curationCount: 0, lastConsolidatedAt: ''}
      await DirectoryManager.writeFileAtomic(metaPath, JSON.stringify(meta, null, 2))
      anyCreated = true
    }

    return anyCreated
  }

  /**
   * Atomically increment the curation counter and return the updated meta.
   */
  async incrementCurationCount(): Promise<ExperienceMeta> {
    const meta = await this.readMeta()
    const updated: ExperienceMeta = {...meta, curationCount: meta.curationCount + 1}
    await this.writeMeta(updated)
    return updated
  }

  /**
   * Read raw file content. Used by ExperienceConsolidationService.
   */
  async readFile(filename: string): Promise<string> {
    const filePath = join(this.experienceDir, filename)
    return DirectoryManager.readFile(filePath)
  }

  /**
   * Read the local-only meta state (_meta.json).
   *
   * - Missing file → safe default (first run before ensureInitialized).
   * - Malformed JSON → throws; do not silently reset the curation counter.
   */
  async readMeta(): Promise<ExperienceMeta> {
    const metaPath = join(this.experienceDir, EXPERIENCE_META_FILE)

    let raw: string
    try {
      raw = await DirectoryManager.readFile(metaPath)
    } catch {
      // File does not exist — expected on first run
      return {curationCount: 0, lastConsolidatedAt: ''}
    }

    // JSON.parse throws on malformed content — intentionally not caught here
    const parsed = JSON.parse(raw) as Partial<ExperienceMeta>
    return {
      curationCount: typeof parsed.curationCount === 'number' ? parsed.curationCount : 0,
      lastConsolidatedAt:
        typeof parsed.lastConsolidatedAt === 'string' ? parsed.lastConsolidatedAt : '',
    }
  }

  /**
   * Read bullet lines from a named section, stripped of the leading "- ".
   * Returns an empty array if the file or section does not exist.
   * Re-throws non-ENOENT read errors so callers do not mistake I/O failures
   * for genuinely empty knowledge.
   * Used by ExperienceHookService for in-memory deduplication.
   */
  async readSectionLines(filename: string, section: string): Promise<string[]> {
    const filePath = join(this.experienceDir, filename)

    let content: string
    try {
      content = await DirectoryManager.readFile(filePath)
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'ENOENT') {
        throw error
      }

      return []
    }

    const marker = `\n## ${section}\n`
    const start = content.indexOf(marker)
    if (start === -1) return []

    const sectionStart = start + marker.length
    const nextHeading = content.indexOf('\n## ', sectionStart)
    const sectionContent =
      nextHeading === -1 ? content.slice(sectionStart) : content.slice(sectionStart, nextHeading)

    return sectionContent
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2))
  }

  /**
   * Write raw file content. Used by ExperienceConsolidationService to persist
   * consolidated output.
   *
   * @throws if content is missing frontmatter — protects against bad LLM output
   */
  async writeFile(filename: string, content: string): Promise<void> {
    // Use parseFrontmatterScoring: validates frontmatter at file start (not anywhere in body)
    // and handles both LF and CRLF line endings — same logic as the rest of the pipeline.
    if (!parseFrontmatterScoring(content)) {
      throw new Error(
        `Refusing to write experience file "${filename}": content is missing a valid frontmatter block`,
      )
    }

    // Normalize to LF so appendBulletsToSection() and readSectionLines() section markers
    // (\n## <section>\n) work correctly on all content written through this method.
    const normalized = content.replaceAll('\r\n', '\n')
    const filePath = join(this.experienceDir, filename)
    await DirectoryManager.writeFileAtomic(filePath, normalized)
  }

  /**
   * Patch and persist meta fields.
   */
  async writeMeta(patch: Partial<ExperienceMeta>): Promise<void> {
    const current = await this.readMeta()
    const updated: ExperienceMeta = {...current, ...patch}
    const metaPath = join(this.experienceDir, EXPERIENCE_META_FILE)
    await DirectoryManager.writeFileAtomic(metaPath, JSON.stringify(updated, null, 2))
  }
}
