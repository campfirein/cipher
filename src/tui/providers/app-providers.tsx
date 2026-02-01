/**
 * App Providers
 *
 * Composes all context providers in the correct order.
 * Single wrapper for repl-startup.tsx to use.
 */

import React from 'react'

import type {AuthToken} from '../../server/core/domain/entities/auth-token.js'
import type {BrvConfig} from '../../server/core/domain/entities/brv-config.js'
import type {ITokenStore} from '../../server/core/interfaces/auth/i-token-store.js'
import type {IConnectorManager} from '../../server/core/interfaces/connectors/i-connector-manager.js'
import type {ITrackingService} from '../../server/core/interfaces/services/i-tracking-service.js'
import type {IOnboardingPreferenceStore} from '../../server/core/interfaces/storage/i-onboarding-preference-store.js'
import type {IProjectConfigStore} from '../../server/core/interfaces/storage/i-project-config-store.js'

import {
  AuthProvider,
  CommandsProvider,
  ModeProvider,
  OnboardingProvider,
  ServicesProvider,
  StatusProvider,
  TasksProvider,
  ThemeProvider,
  TransportProvider,
} from '../contexts/index.js'

interface AppProvidersProps {
  children: React.ReactNode
  connectorManager: IConnectorManager
  initialAuthToken?: AuthToken
  initialBrvConfig?: BrvConfig
  onboardingPreferenceStore: IOnboardingPreferenceStore
  projectConfigStore: IProjectConfigStore
  tokenStore: ITokenStore
  trackingService: ITrackingService
  version: string
}

export function AppProviders({
  children,
  connectorManager,
  initialAuthToken,
  initialBrvConfig,
  onboardingPreferenceStore,
  projectConfigStore,
  tokenStore,
  trackingService,
  version,
}: AppProvidersProps): React.ReactElement {
  return (
    <ServicesProvider
      connectorManager={connectorManager}
      onboardingPreferenceStore={onboardingPreferenceStore}
      projectConfigStore={projectConfigStore}
      tokenStore={tokenStore}
      trackingService={trackingService}
      version={version}
    >
      <AuthProvider initialAuthToken={initialAuthToken} initialBrvConfig={initialBrvConfig}>
        <ThemeProvider>
          <CommandsProvider>
            <ModeProvider>
              <TransportProvider>
                <TasksProvider>
                  <OnboardingProvider>
                    <StatusProvider>{children}</StatusProvider>
                  </OnboardingProvider>
                </TasksProvider>
              </TransportProvider>
            </ModeProvider>
          </CommandsProvider>
        </ThemeProvider>
      </AuthProvider>
    </ServicesProvider>
  )
}
