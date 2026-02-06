/**
 * Theme Store
 *
 * Global Zustand store for theme state.
 */

import {create} from 'zustand'

export interface ThemeColors {
  bg1: string
  bg2: string
  bg3: string
  border: string
  curateCommand: string
  dimPrimary: string
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
    bg3: '#34383D',
    border: '#3D3D3D',
    curateCommand: '#E5C76B',
    dimPrimary: '#067457',
    dimText: '#747474',
    errorText: '#E5484D',
    info: '#00B8D9',
    logoBold: '#00CC66',
    logoDecor: '#00E6A8',
    logoVersion: '#7FFFD4',
    primary: '#0AA77D',
    queryCommand: '#C477FF',
    secondary: '#4CCEBF60',
    text: '#CBCBCB',
    warning: '#F5A623',
  },
}

export const themes = {
  default: defaultTheme,
} as const

export type ThemeName = keyof typeof themes

export interface ThemeState {
  theme: Theme
}

export interface ThemeActions {
  setTheme: (name: ThemeName) => void
}

export const useThemeStore = create<ThemeActions & ThemeState>()((set) => ({
  setTheme: (name: ThemeName) => set({theme: themes[name]}),

  theme: defaultTheme,
}))

/**
 * Alias for backwards compatibility with context API consumers.
 * Components can use either useTheme() or useThemeStore().
 */
export const useTheme = useThemeStore
