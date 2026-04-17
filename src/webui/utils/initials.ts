/**
 * Extract initials from a name, handling hyphens, underscores, and spaces.
 * @param name The full name to extract initials from.
 * @returns The initials of the name.
 */
export function initials(name: string): string {
  const parts = name.split(/[-_\s]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}
