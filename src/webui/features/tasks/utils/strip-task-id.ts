/**
 * Agent code-exec tools often inject the task UUID into local-variable names
 * (e.g. `__curate_ctx_e995b34e_2c1b_491d_bd30_611eabedf3bb`) and into JSON
 * `locals` keys. The suffix is identical for every variable in a given task,
 * so it carries no information for the human reader — it just buries the
 * useful identifier (`__curate_ctx`) under noise.
 *
 * Strip the underscore-form of the task UUID wherever it appears, leaving the
 * base identifier intact.
 */
export function stripTaskIdSuffix(text: string, taskId: string): string {
  if (!text || !taskId) return text
  const underscoreId = taskId.replaceAll('-', '_')
  const pattern = new RegExp(`_${underscoreId}\\b`, 'g')
  return text.replaceAll(pattern, '')
}

/**
 * Code-exec tool calls almost always start with a `//` comment that's the
 * agent's own summary of what the code does. For the collapsed preview that's
 * a much better signal than the first three lines of code. Returns the comment
 * text without the leading `//`, or undefined if the code doesn't begin with
 * one.
 */
export function extractCodeSummary(code: string): string | undefined {
  const first = code.trim().split('\n')[0]?.trim()
  if (!first) return undefined

  if (first.startsWith('//')) {
    return first.replace(/^\/\/+\s*/, '').trim() || undefined
  }

  if (first.startsWith('/*')) {
    const singleLine = /^\/\*+\s*(.+?)\s*\*\/$/.exec(first)
    if (singleLine) return singleLine[1].trim() || undefined
    return first.replace(/^\/\*+\s*/, '').trim() || undefined
  }

  return undefined
}
