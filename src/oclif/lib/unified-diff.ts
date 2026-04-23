/**
 * Line-oriented unified diff — inline implementation.
 *
 * Used by `brv harness diff` to show what the refiner changed between
 * two harness versions. Kept inline (no new devDep) per the
 * dependency-minimization policy: the algorithm below is a standard
 * LCS-on-lines + emit, correct for the v1.0 use case (harness code
 * bodies ≲ a few hundred lines, all-text, no binary).
 *
 * Output shape is intentionally minimal: header lines (`--- a`,
 * `+++ b`) + line-by-line `-`/`+`/` ` markers, no hunk headers. Phase
 * 8's smoke script asserts on `+`/`-` presence, not on `@@` hunks;
 * adding hunk windowing is a follow-up if a renderer wants it.
 */

export interface UnifiedDiff {
  readonly lineAdds: number
  readonly lineDeletes: number
  /**
   * Unified diff as a single string, newline-separated. Empty when
   * the inputs are identical.
   */
  readonly unifiedDiff: string
}

/**
 * Produce a line-oriented unified diff for two text blobs.
 *
 * `fromLabel` / `toLabel` are the header tags (usually version ids)
 * displayed on the `--- ` / `+++ ` lines. Identical inputs produce
 * `{unifiedDiff: '', lineAdds: 0, lineDeletes: 0}`.
 */
export function unifiedDiff(
  from: string,
  to: string,
  fromLabel = 'from',
  toLabel = 'to',
): UnifiedDiff {
  if (from === to) {
    return {lineAdds: 0, lineDeletes: 0, unifiedDiff: ''}
  }

  const fromLines = splitLines(from)
  const toLines = splitLines(to)
  const edits = diffLines(fromLines, toLines)

  let lineAdds = 0
  let lineDeletes = 0
  const out: string[] = [`--- ${fromLabel}`, `+++ ${toLabel}`]

  for (const edit of edits) {
    if (edit.kind === 'add') {
      out.push(`+${edit.line}`)
      lineAdds++
    } else if (edit.kind === 'delete') {
      out.push(`-${edit.line}`)
      lineDeletes++
    } else {
      out.push(` ${edit.line}`)
    }
  }

  return {lineAdds, lineDeletes, unifiedDiff: out.join('\n')}
}

interface Edit {
  readonly kind: 'add' | 'delete' | 'keep'
  readonly line: string
}

/**
 * Classic O(n·m) LCS DP, then reconstruct the edit script. v1.0-safe
 * for inputs under a few thousand lines — harness bodies are tiny.
 * Revisit with Myers if we ever diff full module files.
 */
function diffLines(a: readonly string[], b: readonly string[]): Edit[] {
  const n = a.length
  const m = b.length
  // dp[i][j] = length of LCS of a[0..i-1] and b[0..j-1]
  const dp: number[][] = Array.from({length: n + 1}, () => Array.from({length: m + 1}, () => 0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const edits: Edit[] = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      edits.push({kind: 'keep', line: a[i - 1]})
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      edits.push({kind: 'delete', line: a[i - 1]})
      i--
    } else {
      edits.push({kind: 'add', line: b[j - 1]})
      j--
    }
  }

  while (i > 0) {
    edits.push({kind: 'delete', line: a[i - 1]})
    i--
  }

  while (j > 0) {
    edits.push({kind: 'add', line: b[j - 1]})
    j--
  }

  return edits.reverse()
}

/**
 * Normalise trailing-newline divergence before splitting. A file that
 * ends with `\n` and one that doesn't should diff only on real content
 * changes, not on the presence of an empty string after the last line.
 * `'a\n'.split('\n') === ['a', '']` is JavaScript's line-splitting trap;
 * stripping one trailing newline (only when present) makes the result
 * match the user's mental model of "lines".
 */
function splitLines(s: string): string[] {
  if (s === '') return []
  const trimmed = s.endsWith('\n') ? s.slice(0, -1) : s
  return trimmed.split('\n')
}
