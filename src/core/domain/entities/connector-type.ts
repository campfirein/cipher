/**
 * Array of all supported connector types.
 * Each connector type represents a different method for integrating BRV with coding agents.
 *
 * - 'rules': Agent reads instructions from a rule file (e.g., CLAUDE.md)
 * - 'hook': Instructions are injected on each prompt via agent hooks
 * - 'mcp': Agent uses mcp tools to interact with brv
 */
export const CONNECTOR_TYPES = ['rules', 'hook', 'mcp'] as const

export type ConnectorType = (typeof CONNECTOR_TYPES)[number]
