/**
 * Services Context
 *
 * Provides dependency injection for stores and app config.
 * This context is stable - values don't change during the app lifecycle.
 */

import React, {createContext, useContext, useMemo} from 'react'

import type {IOnboardingPreferenceStore} from '../../core/interfaces/i-onboarding-preference-store.js'
import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../core/interfaces/i-tracking-service.js'

export interface ServicesContextValue {
  onboardingPreferenceStore: IOnboardingPreferenceStore
  projectConfigStore: IProjectConfigStore
  tokenStore: ITokenStore
  trackingService: ITrackingService
  version: string
}

const ServicesContext = createContext<ServicesContextValue | undefined>(undefined)

interface ServicesProviderProps {
  children: React.ReactNode
  onboardingPreferenceStore: IOnboardingPreferenceStore
  projectConfigStore: IProjectConfigStore
  tokenStore: ITokenStore
  trackingService: ITrackingService
  version: string
}

export function ServicesProvider({
  children,
  onboardingPreferenceStore,
  projectConfigStore,
  tokenStore,
  trackingService,
  version,
}: ServicesProviderProps): React.ReactElement {
  const value = useMemo(
    () => ({onboardingPreferenceStore, projectConfigStore, tokenStore, trackingService, version}),
    [onboardingPreferenceStore, projectConfigStore, tokenStore, trackingService, version],
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
