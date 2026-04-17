export function getProjectName(projectPath: string): string {
  return projectPath.split('/').at(-1) ?? projectPath
}
