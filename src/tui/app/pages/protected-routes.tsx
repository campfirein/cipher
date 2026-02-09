/**
 * ProtectedRoutes
 *
 * Switches between pages based on the current view mode.
 * Rendered inside AuthGuard after authentication is confirmed.
 */

import React from 'react'

import {useOnboarding} from '../../hooks/index.js'
import {HomePage} from './home-page.js'
import {InitPage} from './init-page.js'
import {OnboardingPage} from './onboarding-page.js'

export function ProtectedRoutes(): React.ReactNode {
  const {viewMode} = useOnboarding()

  if (viewMode.type === 'loading') {
    return null
  }

  if (viewMode.type === 'onboarding') {
    return <OnboardingPage />
  }

  if (viewMode.type === 'init') {
    return <InitPage />
  }

  return <HomePage />
}
