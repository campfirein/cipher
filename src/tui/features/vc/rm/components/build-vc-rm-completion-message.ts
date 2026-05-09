/**
 * Builds the completion message rendered by `VcRmFlow` after a successful `vc rm` call.
 *
 * Mirrors `git rm`'s semantics:
 *  - `--quiet` produces a fully silent success (empty string).
 *  - Otherwise: each `rm '<path>'` per-file line, followed by a single summary line
 *    ("Removed N file(s).", "Nothing to remove.", or "Would remove N file(s)." for dry-run).
 *
 * Kept as a pure function so the quiet/non-quiet contract can be unit-tested without
 * spinning up an Ink renderer or stubbing the daemon transport.
 */
export type VcRmRenderResult = {
  dryRun?: boolean
  filesRemoved: number
  perFile: string[]
}

export type VcRmRenderRequest = {
  quiet?: boolean
}

export function buildVcRmCompletionMessage(result: VcRmRenderResult, request: VcRmRenderRequest): string {
  if (request.quiet) return ''

  const lines: string[] = [...result.perFile]

  if (result.dryRun) {
    lines.push(`Would remove ${result.filesRemoved} file(s).`)
  } else if (result.filesRemoved === 0) {
    lines.push('Nothing to remove.')
  } else {
    lines.push(`Removed ${result.filesRemoved} file(s).`)
  }

  return lines.join('\n')
}
