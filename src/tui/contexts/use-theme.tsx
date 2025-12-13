/**
 * Theme Context
 *
 * Global context for managing theme state across the entire app.
 * Any component can access the current theme or switch themes dynamically.
 *
 * Usage:
 * ```tsx
 * const {theme, setTheme} = useTheme()
 *
 * // Access theme properties
 * <Text color={theme.colors.primary}>Hello</Text>
 *
 * // Switch theme (future feature)
 * setTheme('default')
 * ```
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

export interface ThemeColors {
  bg1: string
  bg2: string
  border: string
  curateCommand: string
  dimText: string
  errorText: string
  info: string
  logoBold: string
  logoDecor: string
  logoVersion: string
  primary: string
  queryCommand: string
  secondary: string
  text: string
  warning: string
}

export interface Theme {
  colors: ThemeColors
}

const defaultTheme: Theme = {
  colors: {
    bg1: '#020202',
    bg2: '#222221',
    border: '#3D3D3D',
    curateCommand: '#E5C76B',
    dimText: '#747474',
    errorText: '#E5484D',
    info: '#00B8D9',
    logoBold: '#00CC66',
    logoDecor: '#00E6A8',
    logoVersion: '#7FFFD4',
    primary: '#03BF86',
    queryCommand: '#C477FF',
    secondary: '#4CCEBF60',
    text: '#F3F3F3',
    warning: '#F5A623'
  },
}

export const themes = {
  default: defaultTheme,
} as const

export type ThemeName = keyof typeof themes

interface ThemeContextValue {
  setTheme: (name: ThemeName) => void
  theme: Theme
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

interface ThemeProviderProps {
  children: React.ReactNode
  initialTheme?: ThemeName
}

export function ThemeProvider({ children, initialTheme = 'default' }: ThemeProviderProps): React.ReactElement {
  const [theme, setThemeState] = useState<Theme>(themes[initialTheme])

  const setTheme = useCallback((name: ThemeName) => {
    setThemeState(themes[name])
  }, [])

  const contextValue = useMemo(
    () => ({
      setTheme,
      theme,
    }),
    [theme, setTheme],
  )

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }

  return context
}
