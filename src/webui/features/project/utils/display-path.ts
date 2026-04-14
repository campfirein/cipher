export function displayPath(fullPath: string): string {
  const home = '/Users/'
  if (fullPath.startsWith(home)) {
    const rest = fullPath.slice(home.length)
    const slash = rest.indexOf('/')
    if (slash !== -1) return `~${rest.slice(slash)}`
  }

  return fullPath
}
