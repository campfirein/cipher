import {createBrowserRouter} from 'react-router-dom'

import {AuthGuard} from './features/auth/components/auth-guard'
import {MainLayout} from './layouts/main-layout'
import {AnalyticsPage} from './pages/analytics-page'
import {ConnectorsPage} from './pages/connectors-page'
import {ContextsPage} from './pages/contexts-page'
import {HomePage} from './pages/home-page'
import {HubPage} from './pages/hub-page'
import {LoginPage} from './pages/login-page'
import {ModelPage} from './pages/model-page'
import {ProvidersPage} from './pages/providers-page'
import {SessionPage} from './pages/session-page'
import {SpacesPage} from './pages/spaces-page'
import {StatusPage} from './pages/status-page'
import {SyncPage} from './pages/sync-page'

export const router = createBrowserRouter(
  [
    {
      element: <LoginPage />,
      path: '/login',
    },
    {
      children: [
        {
          children: [
            {
              element: <HomePage />,
              index: true,
            },
            {
              element: <StatusPage />,
              path: 'status',
            },
            {
              element: <ProvidersPage />,
              path: 'providers',
            },
            {
              element: <ModelPage />,
              path: 'models',
            },
            {
              element: <SyncPage />,
              path: 'sync',
            },
            {
              element: <SpacesPage />,
              path: 'spaces',
            },
            {
              element: <SessionPage />,
              path: 'session',
            },
            {
              element: <ConnectorsPage />,
              path: 'connectors',
            },
            {
              element: <HubPage />,
              path: 'hub',
            },
            {
              element: <AnalyticsPage />,
              path: 'analytics',
            },
            {
              element: <ContextsPage />,
              path: 'contexts',
            },
          ],
          element: <MainLayout />,
        },
      ],
      element: <AuthGuard />,
      path: '/',
    },
  ],
)
