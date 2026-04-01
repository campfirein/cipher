import {access, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

const GITIGNORE_ENTRIES = `# ByteRover — .brv/context-tree/ contains a nested .git managed by brv vc.
# Without these entries, \`git add .\` fails with "does not have a commit checked out".
.brv/
`

/**
 * Appends ByteRover gitignore entries to the project's .gitignore.
 *
 * Only acts when the project is a git repo (.git/ exists).
 * Idempotent: skips if entries are already present.
 * Best-effort: failures are silently ignored since gitignore
 * is a convenience feature that should never block the caller.
 */
export async function ensureGitignoreEntries(directory: string): Promise<void> {
  try {
    const dir = directory

    // Only add entries in git repositories
    await access(join(dir, '.git'))

    const gitignorePath = join(dir, '.gitignore')
    let existing = ''
    try {
      existing = await readFile(gitignorePath, 'utf8')
    } catch {
      // .gitignore doesn't exist yet — will create it
    }

    // Idempotent: skip if already present
    if (existing.includes('.brv/*')) return

    // Ensure a blank line separates existing content from new entries
    let content: string
    if (existing.length === 0) {
      content = GITIGNORE_ENTRIES
    } else if (existing.endsWith('\n')) {
      content = existing + '\n' + GITIGNORE_ENTRIES
    } else {
      content = existing + '\n\n' + GITIGNORE_ENTRIES
    }

    await writeFile(gitignorePath, content, 'utf8')
  } catch {
    // Best-effort — gitignore failure should not block the caller
  }
}
