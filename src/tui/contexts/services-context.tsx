/**
 * Services Context
 *
 * Provides dependency injection for stores and app config.
 * This context is stable - values don't change during the app lifecycle.
 */

import React, {createContext, useContext, useMemo} from 'react'

import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'

export interface ServicesContextValue {
  projectConfigStore: IProjectConfigStore
  tokenStore: ITokenStore
  version: string
}

const ServicesContext = createContext<ServicesContextValue | undefined>(undefined)

interface ServicesProviderProps {
  children: React.ReactNode
  projectConfigStore: IProjectConfigStore
  tokenStore: ITokenStore
  version: string
}

export function ServicesProvider({
  children,
  projectConfigStore,
  tokenStore,
  version,
}: ServicesProviderProps): React.ReactElement {
  const value = useMemo(() => ({projectConfigStore, tokenStore, version}), [projectConfigStore, tokenStore, version])

  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
}

export function useServices(): ServicesContextValue {
  const context = useContext(ServicesContext)
  if (!context) {
    throw new Error('useServices must be used within ServicesProvider')
  }

  return context
}
