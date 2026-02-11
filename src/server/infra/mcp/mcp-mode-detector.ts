import {existsSync} from 'node:fs'
import {dirname, join} from 'node:path'

/**
 * Operating mode for the MCP server.
 *
 * - 'project': MCP server launched from within a brv project directory.
 *   Tools use the project directory as default clientCwd.
 * - 'global': MCP server launched from a non-project directory (e.g., Windsurf).
 *   Each tool call must provide `cwd` to identify the target project.
 */
export type McpMode = 'global' | 'project'

export type McpModeResult = {mode: McpMode; projectRoot?: string}

/**
 * Detects whether the MCP server is running in project or global mode.
 *
 * Walks up from workingDirectory looking for `.brv/config.json`.
 * If found, returns project mode with the discovered project root.
 * If the filesystem root is reached without finding it, returns global mode.
 */
export function detectMcpMode(workingDirectory: string): McpModeResult {
  let current = workingDirectory
  let parent = dirname(current)
  while (current !== parent) {
    if (existsSync(join(current, '.brv', 'config.json'))) {
      return {mode: 'project', projectRoot: current}
    }

    current = parent
    parent = dirname(current)
  }

  // Check the root directory itself
  if (existsSync(join(current, '.brv', 'config.json'))) {
    return {mode: 'project', projectRoot: current}
  }

  return {mode: 'global'}
}
