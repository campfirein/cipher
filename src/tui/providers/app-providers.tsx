/**
 * App Providers
 *
 * Composes all context providers in the correct order.
 * Single wrapper for repl-startup.tsx to use.
 */

import React from 'react'

import type { AuthToken } from '../../core/domain/entities/auth-token.js'
import type { BrvConfig } from '../../core/domain/entities/brv-config.js'
import type { IProjectConfigStore } from '../../core/interfaces/i-project-config-store.js'
import type { ITokenStore } from '../../core/interfaces/i-token-store.js'

import { AuthProvider, ConsumerProvider, ServicesProvider } from '../contexts/index.js'
import { CommandsProvider } from '../contexts/use-commands.js'
import { ModeProvider } from '../contexts/use-mode.js'
import { ThemeProvider } from '../contexts/use-theme.js'

interface AppProvidersProps {
  children: React.ReactNode
  initialAuthToken?: AuthToken
  initialBrvConfig?: BrvConfig
  projectConfigStore: IProjectConfigStore
  tokenStore: ITokenStore
  version: string
}

export function AppProviders({
  children,
  initialAuthToken,
  initialBrvConfig,
  projectConfigStore,
  tokenStore,
  version,
}: AppProvidersProps): React.ReactElement {
  return (
    <ServicesProvider projectConfigStore={projectConfigStore} tokenStore={tokenStore} version={version}>
      <AuthProvider initialAuthToken={initialAuthToken} initialBrvConfig={initialBrvConfig}>
        <ThemeProvider>
          <CommandsProvider>
            <ModeProvider>
              <ConsumerProvider>{children}</ConsumerProvider>
            </ModeProvider>
          </CommandsProvider>
        </ThemeProvider>
      </AuthProvider>
    </ServicesProvider>
  )
}
