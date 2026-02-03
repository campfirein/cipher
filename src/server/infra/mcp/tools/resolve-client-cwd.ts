import {isAbsolute} from 'node:path'

export type CwdResolutionResult =
  | {clientCwd: string; success: true}
  | {error: string; success: false}

/**
 * Resolves the effective clientCwd for an MCP tool call.
 *
 * Priority: explicit `cwd` parameter > server's working directory.
 *
 * In project mode, getWorkingDirectory() returns the project directory,
 * so `cwd` is optional. In global mode, getWorkingDirectory() returns
 * undefined, so `cwd` is required.
 */
export function resolveClientCwd(
  cwd: string | undefined,
  getWorkingDirectory: () => string | undefined,
): CwdResolutionResult {
  const clientCwd = cwd ?? getWorkingDirectory()

  if (!clientCwd) {
    return {
      error:
        'Error: cwd parameter is required. The MCP server is running in global mode (not inside a ByteRover project). ' +
        'Provide the project directory path in the cwd parameter.',
      success: false,
    }
  }

  if (!isAbsolute(clientCwd)) {
    return {
      error: 'Error: cwd must be an absolute path.',
      success: false,
    }
  }

  return {clientCwd, success: true}
}
