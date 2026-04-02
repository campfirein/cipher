/**
 * Build the CoGit Git remote URL for a given team and space.
 * Format: {gitApiBaseUrl}/git/{teamId}/{spaceId}.git
 */
export function buildCogitRemoteUrl(baseUrl: string, teamId: string, spaceId: string): string {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/git/${teamId}/${spaceId}.git`
}

/**
 * Remove credentials from a URL, returning only the host + path.
 */
export function stripCredentialsFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Parse a URL that contains /git/{segment1}/{segment2}.git or /git/{segment1}/{segment2}.brv
 * Returns the two segments and whether they look like UUIDs.
 */
export function parseGitPathUrl(url: string): null | {
  areUuids: boolean
  segment1: string
  segment2: string
} {
  try {
    const parsed = new URL(url)
    const match = parsed.pathname.match(/^\/git\/([^/]+)\/([^/]+?)\.(?:git|brv)$/)
    if (!match) return null
    const segment1 = match[1]
    const segment2 = match[2]
    return {areUuids: isUuid(segment1) && isUuid(segment2), segment1, segment2}
  } catch {
    return null
  }
}

/**
 * Parse a user-facing .brv URL to extract team and space names.
 * Expected path: /{teamName}/{spaceName}.brv (no /git/ prefix)
 */
export function parseBrvUrl(url: string): null | {spaceName: string; teamName: string} {
  try {
    const parsed = new URL(url)
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+?)\.brv$/)
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

/**
 * Check if a string looks like a UUID (v1-v7, with hyphens).
 */
function isUuid(value: string): boolean {
  return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
}
