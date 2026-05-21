import {statSync} from 'node:fs'
import path from 'node:path'

/**
 * Read-only resolver for `<bv-topic related="...">` refs.
 *
 * The agent has no filesystem view of `.brv/context-tree/`, so even a
 * well-prompted agent can mistype an extension or reference a topic
 * that hasn't been written yet. This walks each comma-separated ref
 * and surfaces a warning for two failure modes:
 *
 *   - **broken**    — neither `<ref>.html` nor `<ref>/` exists on disk
 *   - **ambiguous** — both `<ref>.html` (a file topic) AND `<ref>/`
 *                     (a folder/domain index) exist; the FE cannot
 *                     pick deterministically
 *
 * Refs that resolve unambiguously to either a file or a folder return
 * no warning. The warner never mutates the attribute and never rejects
 * the write — refs are advisory metadata, and a "forward reference" to
 * a topic about to be curated is legitimate.
 *
 * Parsing is permissive: leading `@` is stripped, any trailing `.html`
 * is stripped before the existence check, surrounding whitespace is
 * trimmed, empty entries are skipped. Path segments containing `..`
 * or `.` are rejected as unsafe without touching the filesystem.
 */
export function computeRelatedWarnings(options: {
  contextTreeRoot: string
  relatedAttr: string | undefined
}): readonly string[] {
  const {contextTreeRoot, relatedAttr} = options
  if (!relatedAttr || relatedAttr.trim().length === 0) return []

  const warnings: string[] = []
  for (const rawEntry of relatedAttr.split(',')) {
    const entry = rawEntry.trim()
    if (entry.length === 0) continue

    const warning = checkRef({contextTreeRoot, originalRef: entry})
    if (warning !== undefined) warnings.push(warning)
  }

  return warnings
}

/**
 * Resolve a single ref against the context-tree root. Returns either
 * undefined (clean) or a single warning string.
 */
function checkRef(options: {contextTreeRoot: string; originalRef: string}): string | undefined {
  const {contextTreeRoot, originalRef} = options

  const stripped = originalRef.startsWith('@') ? originalRef.slice(1) : originalRef
  const withoutExt = stripped.endsWith('.html') ? stripped.slice(0, -'.html'.length) : stripped

  // Reject `.` and `..` segments before any filesystem access. The check
  // must happen on the path the user wrote, not on a normalised form,
  // so an attempted traversal surfaces as `unsafe` rather than `not found`.
  const segments = withoutExt.replaceAll('\\', '/').split('/').filter((s) => s.length > 0)
  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      return `related ref "${originalRef}" contains an unsafe path segment ("${segment}") and was not resolved`
    }
  }

  if (segments.length === 0) {
    return `related ref "${originalRef}" is empty after stripping the leading "@" and is invalid`
  }

  const relative = segments.join('/')
  const filePath = path.resolve(contextTreeRoot, `${relative}.html`)
  const folderPath = path.resolve(contextTreeRoot, relative)

  // Defence in depth: even after segment filtering, both resolved paths
  // must remain inside the context-tree root. A symlink in `contextTreeRoot`
  // could theoretically escape; reject any resolution that does.
  const rootResolved = path.resolve(contextTreeRoot)
  if (!isInsideRoot(filePath, rootResolved) || !isInsideRoot(folderPath, rootResolved)) {
    return `related ref "${originalRef}" resolves outside the context-tree root and was not checked`
  }

  // Single stat call swallowed on any error: a TOCTOU race (file deleted
  // between an existsSync and statSync) would otherwise throw and bubble
  // out, turning a successful curate-after-write into a reported failure.
  // The warner runs post-write — its job is to surface refs, not to fail
  // the operation. ENOENT means "not present"; any other errno means we
  // cannot tell, treat as "not present" to stay advisory.
  const fileExists = safeStatIsFile(filePath)
  const folderExists = safeStatIsDir(folderPath)

  if (fileExists && folderExists) {
    return `related ref "${originalRef}" is ambiguous — both "${relative}.html" (file) and "${relative}/" (folder) exist; the related-pill cannot resolve deterministically`
  }

  if (!fileExists && !folderExists) {
    return `related ref "${originalRef}" was not found — no "${relative}.html" file or "${relative}/" folder exists under the context tree`
  }

  return undefined
}

function isInsideRoot(candidate: string, rootResolved: string): boolean {
  return candidate === rootResolved || candidate.startsWith(rootResolved + path.sep)
}

function safeStatIsFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

function safeStatIsDir(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory()
  } catch {
    return false
  }
}
