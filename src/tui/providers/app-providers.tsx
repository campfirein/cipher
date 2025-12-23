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

import {ChatProvider} from '../contexts/chat-context.js'
import {AuthProvider, ServicesProvider} from '../contexts/index.js'
import {OnboardingProvider} from '../contexts/onboarding-context.js'
import {TransportProvider} from '../contexts/transport-context.js'
import {CommandsProvider} from '../contexts/commands-context.js'
import {ModeProvider} from '../contexts/mode-context.js'
import {ThemeProvider} from '../contexts/theme-context.js'

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
        <ChatProvider>
          <ThemeProvider>
            <CommandsProvider>
              <ModeProvider>
                <TransportProvider>
                  <OnboardingProvider>{children}</OnboardingProvider>
                </TransportProvider>
              </ModeProvider>
            </CommandsProvider>
          </ThemeProvider>
        </ChatProvider>
      </AuthProvider>
    </ServicesProvider>
  )
}
