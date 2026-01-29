/**
 * Auth Context
 *
 * Manages authentication state and login flow.
 * Executes LoginUseCase directly for authentication.
 */

import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react'

import type {AuthToken} from '../../server/core/domain/entities/auth-token.js'
import type {BrvConfig} from '../../server/core/domain/entities/brv-config.js'
import type {ITerminal} from '../../server/core/interfaces/services/i-terminal.js'
import type {AuthState} from '../types.js'

import {getAuthConfig} from '../../server/config/auth.config.js'
import {getCurrentConfig} from '../../server/config/environment.js'
import {OAuthService} from '../../server/infra/auth/oauth-service.js'
import {OidcDiscoveryService} from '../../server/infra/auth/oidc-discovery-service.js'
import {SystemBrowserLauncher} from '../../server/infra/browser/system-browser-launcher.js'
import {CallbackHandler} from '../../server/infra/http/callback-handler.js'
import {FileGlobalConfigStore} from '../../server/infra/storage/file-global-config-store.js'
import {MixpanelTrackingService} from '../../server/infra/tracking/mixpanel-tracking-service.js'
import {LoginUseCase} from '../../server/infra/usecase/login-use-case.js'
import {HttpUserService} from '../../server/infra/user/http-user-service.js'
import {useAuthPolling} from '../hooks/use-auth-polling.js'
import {useServices} from './services-context.js'

export interface AuthContextValue {
  // State
  authToken: AuthToken | undefined
  brvConfig: BrvConfig | undefined
  isInitialConfigLoaded: boolean
  isLoggingIn: boolean
  loginOutput: string[]

  // Computed
  // eslint-disable-next-line perfectionist/sort-interfaces
  authState: AuthState
  isAuthorized: boolean

  // Actions
  login: () => void
  reloadAuth: () => Promise<void>
  reloadBrvConfig: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

interface AuthProviderProps {
  children: React.ReactNode
  initialAuthToken?: AuthToken
  initialBrvConfig?: BrvConfig
}

/**
 * Simple terminal that appends output to state
 * Only supports log/error/warn - interactive prompts throw errors
 */
function createStateTerminal(appendOutput: (line: string) => void): ITerminal {
  return {
    actionStart() {},
    actionStop() {},
    async confirm() {
      return true
    },
    error(message: string) {
      appendOutput(`Error: ${message}`)
    },
    async fileSelector() {
      throw new Error('fileSelector not supported in login terminal')
    },
    async input() {
      throw new Error('input not supported in login terminal')
    },
    log(message?: string) {
      appendOutput(message ?? '')
    },
    async search() {
      throw new Error('search not supported in login terminal')
    },
    async select() {
      throw new Error('select not supported in login terminal')
    },
    warn(message: string) {
      appendOutput(`Warning: ${message}`)
    },
  }
}

export function AuthProvider({children, initialAuthToken, initialBrvConfig}: AuthProviderProps): React.ReactElement {
  const {projectConfigStore, tokenStore, trackingService} = useServices()

  // State
  const [authToken, setAuthToken] = useState<AuthToken | undefined>(initialAuthToken)
  const [brvConfig, setBrvConfig] = useState<BrvConfig | undefined>(initialBrvConfig)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [loginOutput, setLoginOutput] = useState<string[]>([])
  const [isInitialConfigLoaded, setIsInitialConfigLoaded] = useState(false)

  // Computed
  const authState: AuthState = authToken?.isValid() ? 'authorized' : 'unauthorized'
  const isAuthorized = authState === 'authorized'

  // Reload auth state (after login or logout)
  const reloadAuth = useCallback(async () => {
    // Clear display output
    setLoginOutput([])

    try {
      // Reload brv config state before checking auth token
      await reloadBrvConfig()
    } catch {}

    const newToken = await tokenStore.load()
    if (newToken?.isValid()) {
      setAuthToken(newToken)
    } else {
      // Token is undefined or invalid (logged out or expired)
      setAuthToken(undefined)
    }
  }, [tokenStore, projectConfigStore])

  // Reload brv config state
  const reloadBrvConfig = useCallback(async () => {
    const configExists = await projectConfigStore.exists()
    if (configExists) {
      const config = await projectConfigStore.read()
      setBrvConfig(config)
    }
  }, [projectConfigStore])

  // Login action - executes LoginUseCase
  const login = useCallback(() => {
    setIsLoggingIn(true)
    setLoginOutput([])

    const appendOutput = (line: string) => {
      setLoginOutput((prev) => [...prev, line])
    }

    const runLogin = async () => {
      try {
        const config = getCurrentConfig()
        const globalConfigStore = new FileGlobalConfigStore()
        const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})
        const discoveryService = new OidcDiscoveryService()
        const authConfig = await getAuthConfig(discoveryService)

        const useCase = new LoginUseCase({
          authService: new OAuthService(authConfig),
          browserLauncher: new SystemBrowserLauncher(),
          callbackHandler: new CallbackHandler(),
          terminal: createStateTerminal(appendOutput),
          tokenStore,
          trackingService,
          userService: new HttpUserService({apiBaseUrl: config.apiBaseUrl}),
        })

        await useCase.run()
      } catch (error) {
        appendOutput(`Error: ${error instanceof Error ? error.message : 'Login failed'}`)
      } finally {
        setIsLoggingIn(false)
      }
    }

    runLogin()
  }, [tokenStore])

  // Reload brv config state on mount and mark initial load complete
  useEffect(() => {
    reloadBrvConfig().then(() => {
      setIsInitialConfigLoaded(true)
    })
  }, [reloadBrvConfig])

  // Auth state polling - check token validity and refresh if needed
  useAuthPolling({
    authToken,
    onTokenChange: setAuthToken,
    tokenStore,
    trackingService,
  })

  // Memoize context value
  const value = useMemo(
    () => ({
      authState,
      authToken,
      brvConfig,
      isAuthorized,
      isInitialConfigLoaded,
      isLoggingIn,
      login,
      loginOutput,
      reloadAuth,
      reloadBrvConfig,
    }),
    [authToken, brvConfig, isInitialConfigLoaded, isLoggingIn, loginOutput, authState, isAuthorized, login, reloadAuth],
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
