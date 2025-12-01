import {z} from 'zod'

import type {BufferEncoding} from '../../../../core/domain/cipher/file-system/types.js'
import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'
import type {IFileSystem} from '../../../../core/interfaces/cipher/i-file-system.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'
import {sanitizeFolderName} from '../../../../utils/file-helpers.js'

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
export function createWriteFileTool(fileSystemService: IFileSystem): Tool {
  return {
    description:
      'Write content to a file. Overwrites existing files. Can optionally create parent directories.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {content, createDirs, encoding, filePath} = input as WriteFileInput

      // Call file system service
      const result = await fileSystemService.writeFile(sanitizeFolderName(filePath), content, {
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
