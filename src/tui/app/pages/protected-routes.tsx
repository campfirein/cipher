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
import {InitProjectPage} from './init-project-page.js'

export function ProtectedRoutes(): React.ReactNode {
  const viewMode = useAppViewMode()

  switch (viewMode.type) {
    case 'config-provider': {
      return <ConfigProviderPage />
    }

    case 'init-project': {
      return <InitProjectPage />
    }

    case 'loading': {
      return null
    }

    case 'ready': {
      return <HomePage />
    }
  }
}
