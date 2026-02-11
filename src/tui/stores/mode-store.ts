/**
 * Mode Store
 *
 * Global Zustand store for application mode state and keyboard shortcuts.
 */

import {create} from 'zustand'

export type Mode = 'main' | 'suggestions'

export interface Shortcut {
  description: string
  key: string
}

const SHORTCUTS_BY_MODE: Record<Mode, readonly Shortcut[]> = {
  main: [
    {description: 'navigate', key: '↑↓'},
    {description: 'quit', key: 'ctrl+c'},
  ],
  suggestions: [
    {description: 'navigate', key: '↑↓'},
    {description: 'select', key: 'enter'},
    {description: 'insert', key: 'tab'},
    {description: 'close', key: 'esc'},
  ],
}

export interface ModeState {
  extraShortcuts: Shortcut[]
  mode: Mode
  shortcuts: readonly Shortcut[]
}

export interface ModeActions {
  appendShortcuts: (shortcuts: Shortcut[]) => void
  removeShortcuts: (keys: string[]) => void
  setMode: (mode: Mode) => void
}

const computeShortcuts = (mode: Mode, extraShortcuts: Shortcut[]): readonly Shortcut[] => [
  ...SHORTCUTS_BY_MODE[mode],
  ...extraShortcuts,
]

export const useModeStore = create<ModeActions & ModeState>()((set) => ({
  appendShortcuts: (shortcuts) =>
    set((state) => {
      const newExtra = [...state.extraShortcuts, ...shortcuts]
      return {
        extraShortcuts: newExtra,
        shortcuts: computeShortcuts(state.mode, newExtra),
      }
    }),

  extraShortcuts: [],

  mode: 'main',

  removeShortcuts: (keys) =>
    set((state) => {
      const newExtra = state.extraShortcuts.filter((s) => !keys.includes(s.key))
      return {
        extraShortcuts: newExtra,
        shortcuts: computeShortcuts(state.mode, newExtra),
      }
    }),

  setMode: (mode) =>
    set((state) => ({
      mode,
      shortcuts: computeShortcuts(mode, state.extraShortcuts),
    })),

  shortcuts: SHORTCUTS_BY_MODE.main,
}))

/**
 * Alias for backwards compatibility with context API consumers.
 */
export const useMode = useModeStore
