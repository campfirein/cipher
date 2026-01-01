import path from 'node:path'

import {FileSystemService} from './file-system-service.js'

/**
 * Creates a FileSystemService restricted to the context tree directory.
 * All file operations will be confined to .brv/context-tree/.
 *
 * @param baseWorkingDirectory - The project root directory
 * @returns FileSystemService instance restricted to context-tree
 */
export function createContextTreeFileSystem(baseWorkingDirectory: string): FileSystemService {
  const contextTreePath = path.join(baseWorkingDirectory, '.brv', 'context-tree')

  return new FileSystemService({
    // Only allow paths within context tree (relative to working directory)
    allowedPaths: ['.'],
    // Use default blocked extensions
    blockedExtensions: ['.exe', '.dll', '.so', '.dylib'],
    blockedPaths: [],
    // Reasonable file size limit
    maxFileSize: 10 * 1024 * 1024, // 10MB
    // Restrict working directory to context tree
    workingDirectory: contextTreePath,
  })
}
