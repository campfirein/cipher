/**
 * TUI App - Router Entry Point
 *
 * Routes:
 * - /login: Public login page
 * - /: Protected home page (via AuthGuard)
 */

import React from 'react'
import {RouterProvider} from 'react-router-dom'

import {router} from './router.js'

export const App: React.FC = () => <RouterProvider router={router} />
