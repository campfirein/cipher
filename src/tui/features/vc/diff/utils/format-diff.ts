import chalk from 'chalk'
import {structuredPatch} from 'diff'

import type {IVcDiffFile, IVcDiffsResponse} from '../../../../../shared/transport/events/vc-events.js'

export function formatDiff(response: IVcDiffsResponse): string {
  if (response.diffs.length === 0) return ''
  return response.diffs.map((file) => formatFile(file)).join('')
}

function formatFile(f: IVcDiffFile): string {
  const aPath = f.status === 'added' ? '/dev/null' : `a/${f.path}`
  const bPath = f.status === 'deleted' ? '/dev/null' : `b/${f.path}`

  const lines: string[] = [chalk.bold(`diff --git a/${f.path} b/${f.path}`)]

  if (f.status === 'added') {
    lines.push(chalk.bold('new file mode 100644'))
    if (f.newOid) lines.push(chalk.bold(`index 0000000..${f.newOid}`))
  } else if (f.status === 'deleted') {
    lines.push(chalk.bold('deleted file mode 100644'))
    if (f.oldOid) lines.push(chalk.bold(`index ${f.oldOid}..0000000`))
  } else if (f.oldOid && f.newOid) {
    lines.push(chalk.bold(`index ${f.oldOid}..${f.newOid} 100644`))
  }

  if (f.binary) {
    lines.push(`Binary files ${aPath} and ${bPath} differ`)
    return lines.join('\n') + '\n'
  }

  const patch = structuredPatch(f.path, f.path, f.oldContent, f.newContent, '', '', {context: 3})

  // Skip `---`/`+++` when there are no hunks (e.g. empty file added/deleted).
  // Matches `git diff` which omits these lines when there's nothing to show.
  if (patch.hunks.length === 0) {
    return lines.join('\n') + '\n'
  }

  // Append a tab after paths containing spaces/tabs so the unified-diff parser
  // can unambiguously locate the path end. Matches `git diff` behavior.
  const aHeader = hasWhitespace(f.path) && f.status !== 'added' ? `${aPath}\t` : aPath
  const bHeader = hasWhitespace(f.path) && f.status !== 'deleted' ? `${bPath}\t` : bPath
  lines.push(chalk.bold(`--- ${aHeader}`), chalk.bold(`+++ ${bHeader}`))

  const oldLines = f.oldContent.split('\n')
  for (const hunk of patch.hunks) {
    const header = `@@ -${formatHunkRange(hunk.oldStart, hunk.oldLines)} +${formatHunkRange(hunk.newStart, hunk.newLines)} @@`
    const context = findHunkContext(oldLines, hunk.oldStart)
    lines.push(chalk.cyan(context ? `${header} ${context}` : header))
    for (const line of hunk.lines) {
      if (line.startsWith('+')) lines.push(chalk.green(line))
      else if (line.startsWith('-')) lines.push(chalk.red(line))
      else lines.push(line)
    }
  }

  return lines.join('\n') + '\n'
}

function hasWhitespace(path: string): boolean {
  return /\s/.test(path)
}

/**
 * Approximates git's trailing hunk-context line. Scans backwards from the line before
 * the hunk for the closest non-empty line that starts with an identifier-ish character
 * (matches git's default xfuncname for plain text: `^[A-Za-z_$]`).
 */
function findHunkContext(oldLines: string[], oldStart: number): string | undefined {
  const startIdx = oldStart - 2 // oldStart is 1-based line number of hunk's first line
  for (let i = startIdx; i >= 0; i--) {
    const line = oldLines[i]
    if (line && /^[A-Z_a-z]/.test(line)) return line
  }

  return undefined
}

// Matches `git diff` hunk-range formatting:
// - count === 1: omit `,1`
// - count === 0: emit `<start-1>,0` (git convention — start is the line BEFORE the insertion point)
// - otherwise: `<start>,<count>`
function formatHunkRange(start: number, count: number): string {
  if (count === 0) return `${start - 1},0`
  if (count === 1) return `${start}`
  return `${start},${count}`
}
