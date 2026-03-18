// ---------------------------------------------------------------------------
// Experience bullet cleaner
// ---------------------------------------------------------------------------

/**
 * Conservative cleaning of experience bullets before skill export.
 *
 * ExperienceStore.readSectionLines() already strips the leading "- " prefix,
 * so bullets arrive as plain text.  This function only:
 *   1. Trims whitespace and removes empty entries
 *   2. Deduplicates (case-insensitive, keeps first occurrence)
 *
 * No broad regex scrubbing — bullets from the store are already clean.
 */
export function cleanExperienceBullets(bullets: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const raw of bullets) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      continue
    }

    const key = trimmed.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(trimmed)
  }

  return result
}
