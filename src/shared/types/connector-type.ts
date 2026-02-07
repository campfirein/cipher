/**
 * Array of all supported connector types.
 * Each connector type represents a different method for integrating BRV with coding agents.
 *
 * - 'rules': Agent reads instructions from a rule file (e.g., CLAUDE.md)
 * - 'hook': Instructions are injected on each prompt via agent hooks
 * - 'mcp': Agent uses mcp tools to interact with brv
 * - 'skill': Agent reads skill files from a project subdirectory
 */
export const CONNECTOR_TYPES = ['rules', 'hook', 'mcp', 'skill'] as const

export type ConnectorType = (typeof CONNECTOR_TYPES)[number]

const connectorTypeSet: ReadonlySet<string> = new Set(CONNECTOR_TYPES)

export function isConnectorType(value: string): value is ConnectorType {
  return connectorTypeSet.has(value)
}
