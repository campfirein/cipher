/**
 * MCP server configuration that gets injected into agent config files.
 * Uses Record to allow agent-specific fields (e.g., env, cwd, disabled).
 */
export type McpServerConfig = Record<string, unknown>

/**
 * Result of checking if MCP config exists.
 */
export type McpConfigExistsResult = {
  /** Whether the config file exists */
  fileExists: boolean
  /** Whether the BRV MCP server entry exists in the config */
  serverExists: boolean
}

/**
 * Interface for writing MCP server configurations to agent config files.
 * Different implementations handle different file formats (JSON, TOML, etc.).
 */
export interface IMcpConfigWriter {
  /**
   * Check if the config file and BRV server entry exist.
   *
   * @param filePath - Absolute path to the config file
   * @returns Object indicating file and server existence
   */
  exists(filePath: string): Promise<McpConfigExistsResult>

  /**
   * Remove the BRV MCP server entry from the config file.
   * Does not delete the file, only removes the server entry.
   *
   * @param filePath - Absolute path to the config file
   * @returns True if the server was removed, false if it didn't exist
   */
  remove(filePath: string): Promise<boolean>

  /**
   * Write the MCP server configuration to the config file.
   * Creates the file if it doesn't exist.
   * Preserves existing configuration.
   *
   * @param filePath - Absolute path to the config file
   * @param serverConfig - The MCP server configuration to write
   */
  write(filePath: string, serverConfig: McpServerConfig): Promise<void>
}
