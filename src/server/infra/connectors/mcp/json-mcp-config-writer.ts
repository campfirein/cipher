import {has, set, unset} from 'lodash-es'

import type {IFileService} from '../../../core/interfaces/services/i-file-service.js'
import type {IMcpConfigWriter, McpConfigExistsResult} from '../../../core/interfaces/storage/i-mcp-config-writer.js'
import type {McpServerConfig} from './mcp-connector-config.js'

import {isRecord} from '../../../utils/type-guards.js'

/**
 * Options for constructing JsonMcpConfigWriter.
 */
export type JsonMcpConfigWriterOptions = {
  fileService: IFileService
  /**
   * JSON key path to the MCP server entry, including server name.
   * e.g., ['mcpServers', 'brv'] navigates to { mcpServers: { brv: ... } }
   */
  serverKeyPath: readonly string[]
}

/**
 * Parse JSON and validate it's a Record object.
 * @throws Error if JSON is invalid or not an object
 */
function parseJsonAsRecord(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content)
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object')
  }

  return parsed
}

/**
 * MCP config writer for JSON format files.
 * Handles nested key path navigation for reading/writing MCP server config.
 */
export class JsonMcpConfigWriter implements IMcpConfigWriter {
  private readonly fileService: IFileService
  private readonly serverKeyPath: readonly string[]

  constructor(options: JsonMcpConfigWriterOptions) {
    this.fileService = options.fileService
    this.serverKeyPath = options.serverKeyPath
  }

  async exists(filePath: string): Promise<McpConfigExistsResult> {
    const fileExists = await this.fileService.exists(filePath)

    if (!fileExists) {
      return {fileExists: false, serverExists: false}
    }

    try {
      const content = await this.fileService.read(filePath)
      const json = parseJsonAsRecord(content)
      const serverExists = has(json, this.serverKeyPath)

      return {
        fileExists: true,
        serverExists,
      }
    } catch {
      return {fileExists: true, serverExists: false}
    }
  }

  async remove(filePath: string): Promise<boolean> {
    const fileExists = await this.fileService.exists(filePath)

    if (!fileExists) {
      return false
    }

    const content = await this.fileService.read(filePath)
    const json = parseJsonAsRecord(content)

    // Check if property exists before attempting to unset
    if (!has(json, this.serverKeyPath)) {
      return false
    }

    unset(json, this.serverKeyPath)
    await this.fileService.write(JSON.stringify(json, null, 2), filePath, 'overwrite')

    return true
  }

  async write(filePath: string, serverConfig: McpServerConfig): Promise<void> {
    const fileExists = await this.fileService.exists(filePath)
    let json: Record<string, unknown>

    if (fileExists) {
      const content = await this.fileService.read(filePath)
      json = parseJsonAsRecord(content)
    } else {
      json = {}
    }

    set(json, this.serverKeyPath, {...serverConfig})
    await this.fileService.write(JSON.stringify(json, null, 2), filePath, 'overwrite')
  }
}
