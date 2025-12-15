/**
 * Mode Context
 *
 * Global context for managing application mode state and keyboard shortcuts.
 * Any component can access the current mode, switch modes, or get mode-specific shortcuts.
 *
 * Usage:
 * ```tsx
 * const {mode, setMode, shortcuts} = useMode()
 *
 * // Access current mode
 * console.log(mode) // "activity" or "console"
 *
 * // Switch mode
 * setMode('suggestions')
 *
 * // Access mode-specific shortcuts
 * shortcuts.forEach(s => console.log(`${s.key}: ${s.description}`))
 * ```
 */

import React, {createContext, useCallback, useContext, useMemo, useState} from 'react'

type Mode = 'activity' | 'console' | 'suggestions'

/**
 * Keyboard shortcut definition
 */
export interface Shortcut {
  description: string // Human-readable description
  key: string // Key identifier (e.g., 'tab', '↑', 'escape')
}

/**
 * Keyboard shortcuts by mode
 */
const SHORTCUTS_BY_MODE = {
  activity: [
    {description: 'scroll logs', key: '↑↓'},
    {description: 'switch view', key: 'tab'},
    {description: 'quit', key: 'ctrl+c'},
  ],
  console: [
    {description: 'scroll', key: '↑↓'},
    {description: 'switch view', key: 'tab'},
    {description: 'quit', key: 'ctrl+c'},
  ],
  suggestions: [
    {description: 'navigate', key: '↑↓'},
    {description: 'select', key: 'enter'},
    {description: 'insert', key: 'tab'},
    {description: 'close', key: 'esc'},
  ],
} as const

interface ModeContextValue {
  appendShortcuts: (shortcuts: Shortcut[]) => void
  mode: Mode
  removeShortcuts: (keys: string[]) => void
  setMode: (mode: Mode) => void
  shortcuts: readonly Shortcut[]
}

const ModeContext = createContext<ModeContextValue | undefined>(undefined)

interface ModeProviderProps {
  children: React.ReactNode
  initialMode?: Mode
}

export function ModeProvider({children, initialMode = 'activity'}: ModeProviderProps): React.ReactElement {
  const [mode, setModeState] = useState<Mode>(initialMode)
  const [extraShortcuts, setExtraShortcuts] = useState<Shortcut[]>([])

  const setMode = useCallback((newMode: Mode) => {
    setModeState(newMode)
  }, [])

  const appendShortcuts = useCallback((shortcuts: Shortcut[]) => {
    setExtraShortcuts((prev) => [...prev, ...shortcuts])
  }, [])

  const removeShortcuts = useCallback((keys: string[]) => {
    setExtraShortcuts((prev) => prev.filter((s) => !keys.includes(s.key)))
  }, [])

  const shortcuts = useMemo(() => {
    const base = [...SHORTCUTS_BY_MODE[mode]]
    return [...base, ...extraShortcuts]
  }, [mode, extraShortcuts])

  const contextValue = useMemo(
    () => ({
      appendShortcuts,
      mode,
      removeShortcuts,
      setMode,
      shortcuts,
    }),
    [appendShortcuts, mode, removeShortcuts, setMode, shortcuts],
  )

  return <ModeContext.Provider value={contextValue}>{children}</ModeContext.Provider>
}

export function useMode(): ModeContextValue {
  const context = useContext(ModeContext)
  if (!context) {
    throw new Error('useMode must be used within ModeProvider')
  }

  return context
}
