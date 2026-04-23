export type GitUrlType = 'git' | 'https' | 'ssh' | 'unknown'

const SCP_STYLE_RE = /^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+:[^/].*$/

export function detectGitUrlType(value: string): GitUrlType {
  const trimmed = value.trim()
  if (trimmed === '') return 'unknown'
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return 'https'
  if (trimmed.startsWith('ssh://')) return 'ssh'
  if (trimmed.startsWith('git://')) return 'git'
  if (SCP_STYLE_RE.test(trimmed)) return 'ssh'
  return 'unknown'
}
