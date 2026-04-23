import {detectGitUrlType} from './detect-git-url-type'

/**
 * Returns undefined if the URL is a valid HTTPS remote the webui can push to,
 * otherwise returns a human-readable reason. SSH and git:// are intentionally
 * rejected — the webui's push/pull path uses an HTTPS token, so other schemes
 * won't work from the browser regardless of what git accepts.
 */
export function validateRemoteUrl(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return 'URL is required.'

  const urlType = detectGitUrlType(trimmed)
  if (urlType === 'ssh') return "SSH remotes aren't supported yet — use an HTTPS URL."
  if (urlType !== 'https') return 'Expected an HTTPS URL (e.g. https://byterover.dev/team/space.git).'

  return undefined
}
