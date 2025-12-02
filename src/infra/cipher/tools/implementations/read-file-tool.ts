import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'
import type {IFileSystem} from '../../../../core/interfaces/cipher/i-file-system.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'

/**
 * Input schema for read file tool.
 */
const ReadFileInputSchema = z
  .object({
    filePath: z.string().describe('Absolute path to the file to read'),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum number of lines to read (optional)'),
    offset: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Starting line number (1-based, optional)'),
  })
  .strict()

/**
 * Input type derived from schema.
 */
type ReadFileInput = z.infer<typeof ReadFileInputSchema>

/**
 * Creates the read file tool.
 *
 * Reads the contents of a file with optional pagination support.
 * Supports offset (starting line) and limit (max lines) for large files.
 *
 * @param fileSystemService - File system service dependency
 * @returns Configured read file tool
 */
export function createReadFileTool(fileSystemService: IFileSystem): Tool {
  return {
    description:
      'Read the contents of a file. Supports pagination with offset (1-based line number) and limit (max lines).',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {filePath, limit, offset} = input as ReadFileInput

      // Call file system service
      const result = await fileSystemService.readFile(filePath, {
        limit,
        offset,
      })

      // Return formatted result
      return {
        content: result.content,
        encoding: result.encoding,
        lines: result.lines,
        pagination: result.pagination,
        size: result.size,
        truncated: result.truncated,
        truncatedLineCount: result.truncatedLineCount,
      }
    },
    id: ToolName.READ_FILE,
    inputSchema: ReadFileInputSchema,
  }
}