/**
 * Build the CoGit Git remote URL for a given team and space.
 * Format: {cogitGitBaseUrl}/git/{teamId}/{spaceId}.git
 */
export function buildCogitRemoteUrl(baseUrl: string, teamId: string, spaceId: string): string {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/git/${teamId}/${spaceId}.git`
}
