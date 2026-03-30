import {createHash} from 'node:crypto'
import {appendFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import type {ExperienceEntryFrontmatter, ExperienceMeta, PerformanceLogEntry} from '../../core/domain/experience/experience-types.js'

import {
  BRV_DIR,
  CONTEXT_TREE_DIR,
  EXPERIENCE_DEAD_ENDS_DIR,
  EXPERIENCE_DIR,
  EXPERIENCE_HINTS_DIR,
  EXPERIENCE_LESSONS_DIR,
  EXPERIENCE_META_FILE,
  EXPERIENCE_PERFORMANCE_DIR,
  EXPERIENCE_PERFORMANCE_LOG_FILE,
  EXPERIENCE_REFLECTIONS_DIR,
  EXPERIENCE_STRATEGIES_DIR,
} from '../../constants.js'
import {DirectoryManager} from '../../core/domain/knowledge/directory-manager.js'
import {parseFrontmatterScoring} from '../../core/domain/knowledge/markdown-writer.js'

// ---------------------------------------------------------------------------
// All experience subfolders
// ---------------------------------------------------------------------------

const ALL_SUBFOLDERS = [
  EXPERIENCE_DEAD_ENDS_DIR,
  EXPERIENCE_HINTS_DIR,
  EXPERIENCE_LESSONS_DIR,
  EXPERIENCE_PERFORMANCE_DIR,
  EXPERIENCE_REFLECTIONS_DIR,
  EXPERIENCE_STRATEGIES_DIR,
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a SHA-256 content hash (first 12 hex chars) for dedup. */
export function computeContentHash(text: string): string {
  return createHash('sha256').update(text.toLowerCase().trim()).digest('hex').slice(0, 12)
}

/** Generate a date-prefixed slug filename from text. */
export function generateEntryFilename(text: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const slug = text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 50)
  return `${date}--${slug || 'entry'}.md`
}

export function buildEntryContent(frontmatter: ExperienceEntryFrontmatter, body: string): string {
  const serializedTitle = frontmatter.title
    .replaceAll('\r', '')
    .replaceAll('\n', ' ')
    .replaceAll('"', String.raw`\"`)
  const fm = [
    '---',
    `title: "${serializedTitle}"`,
    `tags: [${frontmatter.tags.map((t) => `"${t}"`).join(', ')}]`,
    `type: ${frontmatter.type}`,
    `contentHash: "${frontmatter.contentHash}"`,
    `importance: ${frontmatter.importance}`,
    `recency: ${frontmatter.recency}`,
    `maturity: ${frontmatter.maturity}`,
  ]

  if (frontmatter.confidence) {
    fm.push(`confidence: "${frontmatter.confidence}"`)
  }

  if (frontmatter.derived_from && frontmatter.derived_from.length > 0) {
    fm.push(`derived_from: [${frontmatter.derived_from.map((d) => `"${d}"`).join(', ')}]`)
  }

  fm.push(`createdAt: "${frontmatter.createdAt}"`, `updatedAt: "${frontmatter.updatedAt}"`, '---', '')

  return fm.join('\n') + body.trim() + '\n'
}


// ---------------------------------------------------------------------------
// ExperienceStore (v2 — entry-based)
// ---------------------------------------------------------------------------

/**
 * Manages read/write operations for the entry-based experience domain
 * under .brv/context-tree/experience/.
 *
 * Each experience signal is stored as an individual markdown file with
 * frontmatter in a type-based subfolder (lessons/, hints/, etc.).
 */
export class ExperienceStore {
  private readonly experienceDir: string

  constructor(baseDirectory?: string) {
    const base = baseDirectory ?? process.cwd()
    this.experienceDir = resolve(base, BRV_DIR, CONTEXT_TREE_DIR, EXPERIENCE_DIR)
  }

  // ---------------------------------------------------------------------------
  // Entry CRUD
  // ---------------------------------------------------------------------------

  /**
   * Append a JSON line to the performance log.
   * Creates the file if it does not exist.
   */
  async appendPerformanceLog(entry: PerformanceLogEntry): Promise<void> {
    const logPath = join(this.experienceDir, EXPERIENCE_PERFORMANCE_DIR, EXPERIENCE_PERFORMANCE_LOG_FILE)
    await DirectoryManager.ensureParentDirectory(logPath)
    const line = JSON.stringify(entry) + '\n'
    await appendFile(logPath, line, 'utf8')
  }

  /**
   * Create an individual entry file in the given subfolder.
   * Returns the generated filename.
   *
   * @throws if the write fails (caller decides fail-open behavior)
   */
  async createEntry(subfolder: string, body: string, frontmatter: ExperienceEntryFrontmatter): Promise<string> {
    const dir = join(this.experienceDir, subfolder)
    await DirectoryManager.createOrUpdateDomain(dir)

    let filename = generateEntryFilename(frontmatter.title)
    let filePath = join(dir, filename)
    const baseFilename = filename.replace(/\.md$/, '')

    // Dedup by filename collision — append -2, -3, etc.
    let counter = 2
    // eslint-disable-next-line no-await-in-loop
    while (await DirectoryManager.fileExists(filePath)) {
      filename = `${baseFilename}-${counter}.md`
      filePath = join(dir, filename)
      counter++
    }

    const content = buildEntryContent(frontmatter, body)
    await DirectoryManager.writeFileAtomic(filePath, content)
    return filename
  }

  /**
   * Ensure the experience directory and all subfolders exist.
   * Runs migration from legacy bullet files if needed.
   *
   * @returns true if any directory or file was newly created
   */
  async ensureInitialized(): Promise<boolean> {
    await DirectoryManager.createOrUpdateDomain(this.experienceDir)

    let anyCreated = false

    // Create all subfolders (sequential to avoid race conditions on shared parent dir)
    for (const subfolder of ALL_SUBFOLDERS) {
      const subPath = join(this.experienceDir, subfolder)
      // eslint-disable-next-line no-await-in-loop
      const exists = await DirectoryManager.folderExists(subPath)
      if (!exists) {
        // eslint-disable-next-line no-await-in-loop
        await DirectoryManager.createOrUpdateDomain(subPath)
        anyCreated = true
      }
    }

    // Seed _meta.json if missing
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
   * List .md entry files in a subfolder, excluding _index.md.
   */
  async listEntries(subfolder: string): Promise<string[]> {
    const dir = join(this.experienceDir, subfolder)
    try {
      const files = await DirectoryManager.listMarkdownFiles(dir)
      // listMarkdownFiles returns relative paths — extract filenames
      return files
        .map((f) => f.split('/').pop() ?? f)
        .filter((f) => f !== '_index.md')
    } catch {
      return []
    }
  }

  /**
   * Read raw content of an entry file.
   */
  async readEntry(subfolder: string, filename: string): Promise<string> {
    const filePath = join(this.experienceDir, subfolder, filename)
    return DirectoryManager.readFile(filePath)
  }

  /**
   * Scan all entries in a subfolder and return the set of contentHash values
   * found in their frontmatter. Used for dedup before createEntry().
   */
  async readEntryContentHashes(subfolder: string): Promise<Set<string>> {
    const entries = await this.listEntries(subfolder)
    const hashes = new Set<string>()

    for (const entry of entries) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const content = await this.readEntry(subfolder, entry)
        const hashMatch = /contentHash:\s*"([a-f0-9]+)"/.exec(content)
        if (hashMatch) {
          hashes.add(hashMatch[1])
        }
      } catch {
        // Fail-open: skip unreadable entries
      }
    }

    return hashes
  }

  /**
   * Read the local-only meta state (_meta.json).
   */
  async readMeta(): Promise<ExperienceMeta> {
    const metaPath = join(this.experienceDir, EXPERIENCE_META_FILE)

    let raw: string
    try {
      raw = await DirectoryManager.readFile(metaPath)
    } catch {
      return {curationCount: 0, lastConsolidatedAt: ''}
    }

    const parsed = JSON.parse(raw) as Partial<ExperienceMeta>
    return {
      curationCount: typeof parsed.curationCount === 'number' ? parsed.curationCount : 0,
      lastConsolidatedAt:
        typeof parsed.lastConsolidatedAt === 'string' ? parsed.lastConsolidatedAt : '',
    }
  }

  /**
   * Read and parse the performance log JSONL file.
   * Returns the last N entries (all entries if lastN is omitted).
   */
  async readPerformanceLog(lastN?: number): Promise<PerformanceLogEntry[]> {
    const logPath = join(this.experienceDir, EXPERIENCE_PERFORMANCE_DIR, EXPERIENCE_PERFORMANCE_LOG_FILE)

    let raw: string
    try {
      raw = await DirectoryManager.readFile(logPath)
    } catch {
      return []
    }

    const lines = raw.trim().split('\n').filter(Boolean)
    const entries: PerformanceLogEntry[] = []

    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as PerformanceLogEntry)
      } catch {
        // Skip malformed lines
      }
    }

    if (lastN !== undefined && lastN > 0) {
      return entries.slice(-lastN)
    }

    return entries
  }

  /**
   * Write an entry file atomically with frontmatter validation.
   *
   * @throws if content is missing frontmatter
   */
  async writeEntry(subfolder: string, filename: string, content: string): Promise<void> {
    if (!parseFrontmatterScoring(content)) {
      throw new Error(
        `Refusing to write experience entry "${subfolder}/${filename}": content is missing a valid frontmatter block`,
      )
    }

    const normalized = content.replaceAll('\r\n', '\n')
    const filePath = join(this.experienceDir, subfolder, filename)
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
