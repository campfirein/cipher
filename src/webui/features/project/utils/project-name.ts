export function getProjectName(projectPath: string): string {
  const trimmed = projectPath.replace(/[/\\]+$/, '')
  const leaf = trimmed.split(/[/\\]/).at(-1)
  return leaf || projectPath
}
