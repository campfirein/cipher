import {createBrowserRouter} from 'react-router-dom'

import {ProjectGuard} from './features/project/components/project-guard'
import {MainLayout} from './layouts/main-layout'
import {AnalyticsPage} from './pages/analytics-page'
import {ChangesPage} from './pages/changes-page'
import {ConfigurationPage} from './pages/configuration-page'
import {ContextsPage} from './pages/contexts-page'
import {HomePage} from './pages/home-page'
import {ProjectSelectorPage} from './pages/project-selector-page'
import {TasksPage} from './pages/tasks-page'

export const router = createBrowserRouter([
  {
    element: <ProjectSelectorPage />,
    path: '/projects',
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
            element: <ChangesPage />,
            path: 'changes',
          },
          {
            element: <ConfigurationPage />,
            path: 'configuration',
          },
          {
            element: <AnalyticsPage />,
            path: 'analytics',
          },
          {
            element: <ContextsPage />,
            path: 'contexts',
          },
          {
            element: <TasksPage />,
            path: 'tasks',
          },
        ],
        element: <MainLayout />,
      },
    ],
    element: <ProjectGuard />,
    path: '/',
  },
])
