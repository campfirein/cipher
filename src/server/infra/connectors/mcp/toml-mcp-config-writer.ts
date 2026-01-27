import type {IFileService} from '../../../core/interfaces/services/i-file-service.js'
import type {IMcpConfigWriter, McpConfigExistsResult} from '../../../core/interfaces/storage/i-mcp-config-writer.js'
import type {McpServerConfig} from './mcp-connector-config.js'

/**
 * Boundary markers for managed ByteRover MCP sections in TOML files.
 */
export const BRV_MCP_TOML_MARKERS = {
  END: '# END BYTEROVER MCP',
  START: '# BEGIN BYTEROVER MCP',
} as const

/**
 * Options for constructing TomlMcpConfigWriter.
 */
export type TomlMcpConfigWriterOptions = {
  fileService: IFileService
  /**
   * The server name to use in the TOML section header.
   * e.g., 'brv' produces [mcp_servers.brv]
   */
  serverName: string
}

/**
 * Convert a JavaScript object to TOML format for MCP server config.
 * Only handles simple key-value pairs and arrays (no nested objects).
 */
function toTomlSection(sectionName: string, config: McpServerConfig): string {
  const lines: string[] = [`[${sectionName}]`]

  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === null) {
      continue
    }

    if (typeof value === 'string') {
      lines.push(`${key} = "${value}"`)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key} = ${value}`)
    } else if (Array.isArray(value)) {
      const arrayStr = value.map((v) => (typeof v === 'string' ? `"${v}"` : String(v))).join(', ')
      lines.push(`${key} = [${arrayStr}]`)
    }
    // Skip nested objects for simplicity
  }

  return lines.join('\n')
}

/**
 * MCP config writer for TOML format files.
 * Uses marker-based insertion/replacement similar to rules connector.
 */
export class TomlMcpConfigWriter implements IMcpConfigWriter {
  private readonly fileService: IFileService
  private readonly serverName: string

  constructor(options: TomlMcpConfigWriterOptions) {
    this.fileService = options.fileService
    this.serverName = options.serverName
  }

  async exists(filePath: string): Promise<McpConfigExistsResult> {
    const fileExists = await this.fileService.exists(filePath)

    if (!fileExists) {
      return {fileExists: false, serverExists: false}
    }

    try {
      const content = await this.fileService.read(filePath)
      const hasMarkers = content.includes(BRV_MCP_TOML_MARKERS.START) && content.includes(BRV_MCP_TOML_MARKERS.END)

      return {
        fileExists: true,
        serverExists: hasMarkers,
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
    const hasMarkers = content.includes(BRV_MCP_TOML_MARKERS.START) && content.includes(BRV_MCP_TOML_MARKERS.END)

    if (!hasMarkers) {
      return false
    }

    const newContent = this.removeMarkerSection(content)

    // eslint-disable-next-line unicorn/prefer-ternary
    if (newContent.trim() === '') {
      await this.fileService.delete(filePath)
    } else {
      await this.fileService.write(newContent, filePath, 'overwrite')
    }

    return true
  }

  async write(filePath: string, serverConfig: McpServerConfig): Promise<void> {
    const fileExists = await this.fileService.exists(filePath)
    const mcpSection = this.buildMcpSection(serverConfig)

    if (!fileExists) {
      await this.fileService.write(mcpSection, filePath, 'overwrite')
      return
    }

    const content = await this.fileService.read(filePath)
    const hasMarkers = content.includes(BRV_MCP_TOML_MARKERS.START) && content.includes(BRV_MCP_TOML_MARKERS.END)

    if (hasMarkers) {
      // Replace existing section
      const newContent = this.replaceMarkerSection(content, mcpSection)
      await this.fileService.write(newContent, filePath, 'overwrite')
    } else {
      // Append to file
      const newContent = content.trimEnd() + '\n\n' + mcpSection
      await this.fileService.write(newContent, filePath, 'overwrite')
    }
  }

  /**
   * Build the MCP section with markers.
   */
  private buildMcpSection(serverConfig: McpServerConfig): string {
    const tomlContent = toTomlSection(`mcp_servers.${this.serverName}`, serverConfig)
    return `${BRV_MCP_TOML_MARKERS.START}\n${tomlContent}\n${BRV_MCP_TOML_MARKERS.END}`
  }

  /**
   * Remove the section between markers (inclusive).
   */
  private removeMarkerSection(content: string): string {
    const startIndex = content.indexOf(BRV_MCP_TOML_MARKERS.START)
    const endIndex = content.indexOf(BRV_MCP_TOML_MARKERS.END)

    if (startIndex === -1 || endIndex === -1) {
      return content
    }

    const before = content.slice(0, startIndex)
    const after = content.slice(endIndex + BRV_MCP_TOML_MARKERS.END.length)

    // Clean up extra newlines
    return (before + after).replaceAll(/\n{3,}/g, '\n\n').trim()
  }

  /**
   * Replace the section between markers with new content.
   */
  private replaceMarkerSection(content: string, newSection: string): string {
    const startIndex = content.indexOf(BRV_MCP_TOML_MARKERS.START)
    const endIndex = content.indexOf(BRV_MCP_TOML_MARKERS.END)

    if (startIndex === -1 || endIndex === -1) {
      return content
    }

    const before = content.slice(0, startIndex)
    const after = content.slice(endIndex + BRV_MCP_TOML_MARKERS.END.length)

    return before + newSection + after
  }
}
