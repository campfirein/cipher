import {resolveProject} from '../project/resolve-project.js'

/**
 * Operating mode for the MCP server.
 *
 * - 'project': MCP server launched from within a brv project directory.
 *   Tools use the project directory as default clientCwd.
 * - 'global': MCP server launched from a non-project directory (e.g., Windsurf).
 *   Each tool call must provide `cwd` to identify the target project.
 */
export type McpMode = 'global' | 'project'

export type McpModeResult =
  | {mode: 'global'}
  | {mode: 'project'; projectRoot: string; worktreeRoot: string}

/**
 * Detects whether the MCP server is running in project or global mode.
 *
 * Uses the canonical project resolver so MCP shares workspace-link semantics
 * with the rest of the CLI.
 */
export function detectMcpMode(workingDirectory: string): McpModeResult {
  const resolution = resolveProject({cwd: workingDirectory})
  if (!resolution) {
    return {mode: 'global'}
  }

  return {
    mode: 'project',
    projectRoot: resolution.projectRoot,
    worktreeRoot: resolution.worktreeRoot,
  }
}
