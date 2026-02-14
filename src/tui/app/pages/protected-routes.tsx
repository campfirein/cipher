/**
 * ProtectedRoutes
 *
 * Switches between pages based on the current view mode.
 * Rendered inside AuthGuard after authentication is confirmed.
 */

import React from 'react'

import {useAppViewMode} from '../../features/onboarding/hooks/use-app-view-mode.js'
import {ConfigProviderPage} from './config-provider-page.js'
import {HomePage} from './home-page.js'

export function ProtectedRoutes(): React.ReactNode {
  const viewMode = useAppViewMode()

  if (viewMode.type === 'loading') {
    return null
  }

  if (viewMode.type === 'config-provider') {
    return <ConfigProviderPage />
  }

  return <HomePage />
}
