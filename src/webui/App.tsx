import {Toaster} from '@campfirein/byterover-packages/components/sonner'
import {RouterProvider} from 'react-router-dom'

import {AppProviders} from './providers/app-providers'
import {router} from './router'

export function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
      <Toaster position="top-center" />
    </AppProviders>
  )
}
