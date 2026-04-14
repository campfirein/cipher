/**
 * Build the CoGit Git remote URL for a given team and space.
 * Format: {baseUrl}/{teamName}/{spaceName}.git
 */
export function buildCogitRemoteUrl(baseUrl: string, teamName: string, spaceName: string): string {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/${teamName}/${spaceName}.git`
}

/**
 * Parse a .git URL to extract team and space names.
 * Expected path: /{teamName}/{spaceName}.git
 */
export function parseUserFacingUrl(url: string): null | {spaceName: string; teamName: string} {
  try {
    const parsed = new URL(url)
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+?)\.git$/)
    if (!match) return null
    return {spaceName: match[2], teamName: match[1]}
  } catch {
    return null
  }
}

/**
 * Validate git branch name (same rules as native git).
 */
export function isValidBranchName(name: string): boolean {
  if (!name) return false
  if (name.startsWith('-') || name.startsWith('.') || name.startsWith('/')) return false
  if (name.endsWith('.lock') || name.endsWith('/') || name.endsWith('.')) return false
  if (name.includes('//') || name.includes('@{') || name.includes(' ')) return false
  // eslint-disable-next-line no-control-regex
  return !/\.\.|[~^:?*[\\\u0000-\u001F\u007F]/.test(name)
}

