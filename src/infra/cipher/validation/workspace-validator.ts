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
 * Checks for the existence of:
 * - `.brv` directory (created by `brv init`)
 * - `.brv/blobs` directory (for blob storage)
 *
 * @param workingDirectory - The working directory to check (defaults to process.cwd())
 * @throws WorkspaceNotInitializedError if workspace is not initialized
 */
export function validateWorkspaceInitialized(workingDirectory?: string): void {
  const cwd = workingDirectory ?? process.cwd()
  const brvDir = join(cwd, '.brv')
  const blobsDir = join(cwd, '.brv', 'blobs')

  // Check if .brv directory exists
  if (!existsSync(brvDir)) {
    throw new WorkspaceNotInitializedError(
      'Workspace not initialized',
      brvDir,
    )
  }

  // Check if .brv/blobs directory exists
  if (!existsSync(blobsDir)) {
    throw new WorkspaceNotInitializedError(
      'Blob storage directory not found',
      blobsDir,
    )
  }
}
