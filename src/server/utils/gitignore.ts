import {access, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {CONTEXT_TREE_GITIGNORE_HEADER, CONTEXT_TREE_GITIGNORE_PATTERNS} from '../constants.js'

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
    await access(join(directory, '.git'))

    const gitignorePath = join(directory, '.gitignore')
    let existing = ''
    try {
      existing = await readFile(gitignorePath, 'utf8')
    } catch {
      // .gitignore doesn't exist yet — will create it
    }

    // Idempotent: skip if already present
    if (existing.includes('.brv/')) return

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

export async function ensureContextTreeGitignore(contextTreeDir: string): Promise<void> {
  try {
    const gitignorePath = join(contextTreeDir, '.gitignore')

    let existing = ''
    try {
      existing = await readFile(gitignorePath, 'utf8')
    } catch {
      // File doesn't exist — will create with full content
    }

    if (existing.length === 0) {
      await writeFile(gitignorePath, CONTEXT_TREE_GITIGNORE_HEADER + '\n' + CONTEXT_TREE_GITIGNORE_PATTERNS.join('\n') + '\n', 'utf8')
      return
    }

    const existingLines = existing.split('\n').map((l) => l.trim())
    const toAppend: string[] = []

    if (!existingLines.includes(CONTEXT_TREE_GITIGNORE_HEADER)) {
      toAppend.push(CONTEXT_TREE_GITIGNORE_HEADER)
    }

    for (const pattern of CONTEXT_TREE_GITIGNORE_PATTERNS) {
      if (existingLines.some((el) => el.includes(pattern))) continue
      toAppend.push(pattern)
    }

    if (toAppend.length === 0) return

    const separator = existing.endsWith('\n') ? '\n' : '\n\n'
    await writeFile(gitignorePath, existing + separator + toAppend.join('\n') + '\n', 'utf8')
  } catch {
    // Best-effort — gitignore sync should never block the caller
  }
}
