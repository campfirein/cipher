import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {IFileSystem} from '../../../core/interfaces/i-file-system.js'

import {ToolName} from '../../../core/domain/tools/constants.js'
import {isImageFile} from '../../file-system/binary-utils.js'

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

      try {
        // Call file system service
        const result = await fileSystemService.readFile(filePath, {
          limit,
          offset,
        })

        // Transform attachment format (singular → plural array)
        let attachments: Array<{data: string; filename: string; mimeType: string; type: 'file' | 'image'}> | undefined
        if (result.attachment) {
          const type = isImageFile(filePath) ? 'image' : 'file'
          attachments = [{
            data: result.attachment.base64,
            filename: result.attachment.fileName,
            mimeType: result.attachment.mimeType,
            type,
          }]
        }

        // Return formatted result with all metadata
        return {
          attachments,
          content: result.formattedContent,
          lines: result.lines,
          message: result.message,
          preview: result.preview,
          size: result.size,
          success: true,
          totalLines: result.totalLines,
          truncated: result.truncated,
          truncatedLineCount: result.truncatedLineCount,
        }
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          success: false,
        }
      }
    },
    id: ToolName.READ_FILE,
    inputSchema: ReadFileInputSchema,
  }
}
