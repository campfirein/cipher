export function getProjectName(projectPath: string): string {
  const trimmed = projectPath.replace(/[/\\]+$/, '')
  const leaf = trimmed.split(/[/\\]/).at(-1)
  return leaf && leaf.length > 0 ? leaf : projectPath
}
