/**
 * Auth Context
 *
 * Manages authentication state and login flow.
 * Spawns login command as child process and captures output.
 */

import {spawn} from 'node:child_process'
import React, {createContext, useCallback, useContext, useMemo, useState} from 'react'

import type {AuthToken} from '../../core/domain/entities/auth-token.js'
import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {AuthState} from '../types.js'

import {useServices} from './services-context.js'

export interface AuthContextValue {
  // State
  authToken: AuthToken | undefined
  brvConfig: BrvConfig | undefined
  isLoggingIn: boolean
  loginOutput: string[]

  // Computed
  // eslint-disable-next-line perfectionist/sort-interfaces
  authState: AuthState
  isAuthorized: boolean

  // Actions
  login: () => void
  reloadAuth: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

interface AuthProviderProps {
  children: React.ReactNode
  initialAuthToken?: AuthToken
  initialBrvConfig?: BrvConfig
}

export function AuthProvider({children, initialAuthToken, initialBrvConfig}: AuthProviderProps): React.ReactElement {
  const {projectConfigStore, tokenStore} = useServices()

  // State
  const [authToken, setAuthToken] = useState<AuthToken | undefined>(initialAuthToken)
  const [brvConfig, setBrvConfig] = useState<BrvConfig | undefined>(initialBrvConfig)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [loginOutput, setLoginOutput] = useState<string[]>([])

  // Computed
  const authState: AuthState = authToken?.isValid() ? 'authorized' : 'unauthorized'
  const isAuthorized = authState === 'authorized'

  // Reload auth state (after login)
  const reloadAuth = useCallback(async () => {
    const newToken = await tokenStore.load()
    if (newToken?.isValid()) {
      setAuthToken(newToken)

      const configExists = await projectConfigStore.exists()
      if (configExists) {
        const config = await projectConfigStore.read()
        setBrvConfig(config)
      }
    }
  }, [tokenStore, projectConfigStore])

  // Login action - spawns child process
  const login = useCallback(() => {
    setIsLoggingIn(true)
    setLoginOutput([])

    const child = spawn(process.execPath, [process.argv[1], 'login'], {
      env: {...process.env},
      stdio: ['inherit', 'pipe', 'pipe'],
    })

    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean)
      setLoginOutput((prev) => [...prev, ...lines])
    })

    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean)
      setLoginOutput((prev) => [...prev, ...lines])
    })

    child.on('close', () => {
      setIsLoggingIn(false)
    })

    child.on('error', (err) => {
      setLoginOutput((prev) => [...prev, `Error: ${err.message}`])
      setIsLoggingIn(false)
    })
  }, [reloadAuth])

  // Memoize context value
  const value = useMemo(
    () => ({
      authState,
      authToken,
      brvConfig,
      isAuthorized,
      isLoggingIn,
      login,
      loginOutput,
      reloadAuth,
    }),
    [authToken, brvConfig, isLoggingIn, loginOutput, authState, isAuthorized, login, reloadAuth],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return context
}
