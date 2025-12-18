/**
 * useTerminalBreakpoint Hook
 *
 * Watches terminal row count and returns current breakpoint.
 */

import {useStdout} from 'ink'

export type TerminalBreakpoint = 'compact' | 'normal'

export interface TerminalBreakpointReturn {
  breakpoint: TerminalBreakpoint
  columns: number
  rows: number
}

/**
 * Hook for determining terminal breakpoint based on row count
 *
 * Breakpoints:
 * - compact: 0 - 23 rows (small terminal, limited space)
 * - normal: >= 24 rows (standard terminal, comfortable space)
 *
 * @returns Current breakpoint and terminal dimensions
 */
export function useTerminalBreakpoint(): TerminalBreakpointReturn {
  const {stdout} = useStdout()
  const rows = stdout?.rows ?? 24
  const columns = stdout?.columns ?? 80

  const breakpoint: TerminalBreakpoint = rows >= 22 ? 'normal' : 'compact'

  return {breakpoint, columns, rows}
}
