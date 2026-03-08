import {z} from 'zod'

import type {EnvironmentContext} from '../../../core/domain/environment/types.js'
import type {BufferEncoding} from '../../../core/domain/file-system/types.js'
import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {IFileSystem} from '../../../core/interfaces/i-file-system.js'

import {sanitizeFolderName} from '../../../../server/utils/file-helpers.js'
import {ToolName} from '../../../core/domain/tools/constants.js'
import {validateWriteTarget} from '../write-guard.js'

/**
 * Input schema for write file tool.
 */
const WriteFileInputSchema = z
  .object({
    content: z.string().describe('Content to write to the file'),
    createDirs: z
      .boolean()
      .optional()
      .default(false)
      .describe("Create parent directories if they don't exist (default: false)"),
    encoding: z
      .enum(['utf8', 'ascii', 'latin1', 'utf16le', 'base64', 'hex'])
      .optional()
      .default('utf8')
      .describe('File encoding (default: utf8)'),
    filePath: z.string().describe('Absolute path where the file should be written'),
  })
  .strict()

/**
 * Input type derived from schema.
 */
type WriteFileInput = z.infer<typeof WriteFileInputSchema>

/**
 * Creates the write file tool.
 *
 * Writes content to a file, overwriting if it exists.
 * Can optionally create parent directories.
 *
 * @param fileSystemService - File system service dependency
 * @returns Configured write file tool
 */
export function createWriteFileTool(fileSystemService: IFileSystem, environmentContext?: EnvironmentContext): Tool {
  return {
    description: 'Write content to a file. Overwrites existing files. Can optionally create parent directories.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {content, createDirs, encoding, filePath} = input as WriteFileInput
      const sanitizedPath = sanitizeFolderName(filePath)

      // Write guard: block writes to knowledge-linked context trees
      if (environmentContext?.workingDirectory) {
        const writeError = validateWriteTarget(sanitizedPath, environmentContext.workingDirectory)
        if (writeError) {
          return {
            bytesWritten: 0,
            error: writeError,
            path: sanitizedPath,
            success: false,
          }
        }
      }

      // Call file system service
      const result = await fileSystemService.writeFile(sanitizedPath, content, {
        createDirs,
        encoding: encoding as BufferEncoding,
      })

      // Return formatted result
      return {
        bytesWritten: result.bytesWritten,
        path: result.path,
        success: result.success,
      }
    },
    id: ToolName.WRITE_FILE,
    inputSchema: WriteFileInputSchema,
  }
}
