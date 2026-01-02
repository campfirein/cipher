import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'
import type {IFileSystem} from '../../../../core/interfaces/cipher/i-file-system.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'

/**
 * Input schema for read file tool.
 */
const ReadFileInputSchema = z
  .object({
    filePath: z.string().describe('Path to the file to read (absolute or relative to working directory)'),
    limit: z.number().int().positive().optional().describe('Maximum number of lines to read (optional, default: 2000)'),
    offset: z.number().int().min(1).optional().describe('Starting line number (1-based, optional)'),
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
 *
 * Features:
 * - Accepts both absolute and relative paths
 * - Image/PDF files returned as base64 attachments for multimodal LLMs
 * - Binary file detection with clear error messages
 * - .env file blocking with whitelist for example files
 * - XML-wrapped output for clearer LLM parsing
 * - Preview metadata for UI display
 *
 * @param fileSystemService - File system service dependency
 * @returns Configured read file tool
 */
export function createReadFileTool(fileSystemService: IFileSystem): Tool {
  return {
    description:
      'Read the contents of a file. Supports relative/absolute paths, pagination, and returns images/PDFs as base64 attachments.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {filePath, limit, offset} = input as ReadFileInput

      // Call file system service
      const result = await fileSystemService.readFile(filePath, {
        limit,
        offset,
      })

      // Return formatted result with all metadata
      return {
        attachment: result.attachment,
        content: result.formattedContent,
        lines: result.lines,
        message: result.message,
        preview: result.preview,
        size: result.size,
        totalLines: result.totalLines,
        truncated: result.truncated,
        truncatedLineCount: result.truncatedLineCount,
      }
    },
    id: ToolName.READ_FILE,
    inputSchema: ReadFileInputSchema,
  }
}
