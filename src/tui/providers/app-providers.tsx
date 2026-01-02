/**
 * App Providers
 *
 * Composes all context providers in the correct order.
 * Single wrapper for repl-startup.tsx to use.
 */

import React from 'react'

import type {AuthToken} from '../../core/domain/entities/auth-token.js'
import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {IOnboardingPreferenceStore} from '../../core/interfaces/i-onboarding-preference-store.js'
import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../core/interfaces/i-tracking-service.js'

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
                    <StatusProvider>
                      {children}
                    </StatusProvider>
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
