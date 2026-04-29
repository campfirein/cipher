/**
 * Working-tree-overwrite error messages, unified across pull / merge / checkout
 * paths. Trailer says "commit or discard" so users know `brv vc reset` is the
 * escape hatch (brv has no stash).
 *
 * The "would be overwritten" anchor is preserved verbatim because vc-handler
 * pattern-matches on it to map GitError → VcError(UNCOMMITTED_CHANGES).
 */
export type OverwriteOperation = 'checkout' | 'merge' | 'pull'

function trailerFor(operation: OverwriteOperation): string {
  const action = operation === 'checkout' ? 'switch branches' : operation
  return `Please commit or discard your changes before you ${action}.`
}

export function formatOverwriteMessage(operation: OverwriteOperation, files: string[]): string {
  const trailer = trailerFor(operation)
  if (files.length === 0) {
    return `Your local changes would be overwritten by ${operation}. ${trailer}`
  }

  const list = files.map((f) => `\t${f}`).join('\n')
  return `Your local changes to the following files would be overwritten by ${operation}:\n${list}\n${trailer}`
}
