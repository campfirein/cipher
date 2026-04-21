// Matches macOS (/Users/<user>/…), Linux (/home/<user>/…), and Windows
// (<drive>:[/\]Users[/\]<user>[/\]…). Capture 1 is the "rest" including its
// leading separator so the replacement preserves the input's separator style.
const HOME_PATH_PATTERN = /^(?:\/Users\/|\/home\/|[A-Za-z]:[/\\]Users[/\\])[^/\\]+([/\\].*)$/

export function displayPath(fullPath: string): string {
  const match = HOME_PATH_PATTERN.exec(fullPath)
  return match ? `~${match[1]}` : fullPath
}
