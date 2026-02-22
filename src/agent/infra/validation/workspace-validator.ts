import {existsSync} from 'node:fs'
import {join} from 'node:path'

/**
 * Error thrown when ByteRover workspace is not initialized.
 */
export class WorkspaceNotInitializedError extends Error {
  /** The expected workspace directory path */
  public readonly expectedPath: string

  public constructor(message: string, expectedPath: string) {
    super(message)
    this.name = 'WorkspaceNotInitializedError'
    this.expectedPath = expectedPath
  }
}

/**
 * Validates that the ByteRover workspace is properly initialized.
 *
 * Checks for the existence of the `.brv` directory (auto-created on first command),
 * which contains config.json and context-tree/.
 * Blob/key storage resides at XDG paths and is not validated here.
 *
 * @param workingDirectory - The working directory to check (defaults to process.cwd())
 * @throws WorkspaceNotInitializedError if workspace is not initialized
 */
export function validateWorkspaceInitialized(workingDirectory?: string): void {
  const cwd = workingDirectory ?? process.cwd()
  const brvDir = join(cwd, '.brv')

  // Check if .brv directory exists
  if (!existsSync(brvDir)) {
    throw new WorkspaceNotInitializedError(
      'Workspace not initialized',
      brvDir,
    )
  }
}
