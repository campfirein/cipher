/**
 * Shared section-parsing utility for experience markdown files.
 *
 * Extracts bullet lines from a named `## Section` in markdown content.
 * Used by migration code to read bullets from legacy experience files.
 */
export function readSectionLinesFromContent(content: string, section: string): string[] {
  const marker = `\n## ${section}\n`
  const start = content.indexOf(marker)
  if (start === -1) return []

  const sectionStart = start + marker.length
  const nextHeading = content.indexOf('\n## ', sectionStart)
  const sectionContent =
    nextHeading === -1 ? content.slice(sectionStart) : content.slice(sectionStart, nextHeading)

  return sectionContent
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2))
}
