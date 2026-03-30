/**
 * Shared section-parsing utility for experience markdown files.
 *
 * Extracts bullet lines from a named `## Section` in markdown content.
 * Used by migration code to read bullets from legacy experience files.
 */
export function readSectionLinesFromContent(content: string, section: string): string[] {
  const heading = `## ${section}\n`
  const marker = `\n${heading}`
  const sectionStart = content.startsWith(heading)
    ? heading.length
    : (() => {
        const start = content.indexOf(marker)
        return start === -1 ? -1 : start + marker.length
      })()

  if (sectionStart === -1) return []

  const nextHeading = content.indexOf('\n## ', sectionStart)
  const sectionContent =
    nextHeading === -1 ? content.slice(sectionStart) : content.slice(sectionStart, nextHeading)

  return sectionContent
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2))
}
