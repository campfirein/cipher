/**
 * Returns true when the given text contains a complete conflict-marker triplet:
 * `<<<<<<<` start, `=======` separator, and `>>>>>>>` end. All three must be present so
 * stray occurrences in normal documents (tutorials about git, markdown setext headings)
 * aren't false-flagged.
 */
export function hasConflictMarkers(content: string): boolean {
  return content.includes('<<<<<<<') && content.includes('=======') && content.includes('>>>>>>>')
}
