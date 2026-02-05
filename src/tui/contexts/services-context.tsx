/**
 * Services Context
 *
 * Provides dependency injection for stores and app config.
 * This context is stable - values don't change during the app lifecycle.
 */

import React, {createContext, useContext, useMemo} from 'react'

import type {ITokenStore} from '../../server/core/interfaces/auth/i-token-store.js'
import type {IConnectorManager} from '../../server/core/interfaces/connectors/i-connector-manager.js'
import type {ITrackingService} from '../../server/core/interfaces/services/i-tracking-service.js'
import type {IOnboardingPreferenceStore} from '../../server/core/interfaces/storage/i-onboarding-preference-store.js'
import type {IProjectConfigStore} from '../../server/core/interfaces/storage/i-project-config-store.js'

export interface ServicesContextValue {
  connectorManager: IConnectorManager
  onboardingPreferenceStore: IOnboardingPreferenceStore
  projectConfigStore: IProjectConfigStore
  tokenStore: ITokenStore
  trackingService: ITrackingService
  version: string
}

const ServicesContext = createContext<ServicesContextValue | undefined>(undefined)

interface ServicesProviderProps {
  children: React.ReactNode
  connectorManager: IConnectorManager
  onboardingPreferenceStore: IOnboardingPreferenceStore
  projectConfigStore: IProjectConfigStore
  tokenStore: ITokenStore
  trackingService: ITrackingService
  version: string
}

export function ServicesProvider({
  children,
  connectorManager,
  onboardingPreferenceStore,
  projectConfigStore,
  tokenStore,
  trackingService,
  version,
}: ServicesProviderProps): React.ReactElement {
  const value = useMemo(
    () => ({
      connectorManager,
      onboardingPreferenceStore,
      projectConfigStore,
      tokenStore,
      trackingService,
      version,
    }),
    [connectorManager, onboardingPreferenceStore, projectConfigStore, tokenStore, trackingService, version],
  )

  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
}

export function useServices(): ServicesContextValue {
  const context = useContext(ServicesContext)
  if (!context) {
    throw new Error('useServices must be used within ServicesProvider')
  }

  return context
}
