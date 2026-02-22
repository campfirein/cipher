/**
 * TUI Router Configuration
 *
 * Uses MemoryRouter for terminal environment (no browser history).
 *
 * Routes:
 * - /login: Public login page
 * - /: Protected routes (requires auth via AuthGuard)
 *       Switches between OnboardingPage, InitPage, HomePage based on viewMode
 */

import React from 'react'
import {createMemoryRouter} from 'react-router-dom'

import {AuthGuard} from '../features/auth/guards/auth-guard.js'
import {LoginPage} from './pages/login-page.js'
import {ProtectedRoutes} from './pages/protected-routes.js'

export const router = createMemoryRouter([
  {
    element: <LoginPage />,
    path: '/login',
  },
  {
    children: [
      {
        element: <ProtectedRoutes />,
        index: true,
      },
    ],
    element: <AuthGuard />,
    path: '/',
  },
])
