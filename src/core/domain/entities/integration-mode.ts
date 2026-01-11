/**
 * Array of all supported integration modes.
 */
export const INTEGRATION_MODES = ['cli', 'mcp'] as const

/**
 * Integration mode for ByteRover rule generation.
 * - 'cli': Standard CLI-based workflow with full command documentation
 * - 'mcp': MCP tool-based workflow with concise tool usage instructions
 */
export type IntegrationMode = (typeof INTEGRATION_MODES)[number]
