/**
 * useTerminalBreakpoint Hook
 *
 * Watches terminal row count and returns current breakpoint.
 */

import {useStdout} from 'ink'
import {useEffect, useState} from 'react'

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
  // Subtract 1 from rows to account for the shell prompt line that launched the app
  const [dimensions, setDimensions] = useState({
    columns: stdout?.columns ?? 80,
    rows: (stdout?.rows ?? 24) - 1,
  })

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        columns: process.stdout.columns,
        rows: process.stdout.rows - 1,
      })
    }

    process.stdout.on('resize', handleResize)

    return () => {
      process.stdout.off('resize', handleResize)
    }
  }, [])

  const {columns, rows} = dimensions
  const breakpoint: TerminalBreakpoint = rows >= 22 ? 'normal' : 'compact'

  return {breakpoint, columns, rows}
}
