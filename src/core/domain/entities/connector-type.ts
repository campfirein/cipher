/**
 * Array of all supported connector types.
 * Each connector type represents a different method for integrating BRV with coding agents.
 *
 * - 'rules': Agent reads instructions from a rule file (e.g., CLAUDE.md)
 * - 'hook': Instructions are injected on each prompt via agent hooks
 */
export const CONNECTOR_TYPES = ['rules', 'hook'] as const

export type ConnectorType = (typeof CONNECTOR_TYPES)[number]
