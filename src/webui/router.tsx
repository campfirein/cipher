import {createBrowserRouter} from 'react-router-dom'

import {HomePage} from './pages/home-page'

export const router = createBrowserRouter(
  [
    {
      element: <HomePage />,
      path: '/',
    },
  ],
  {
    basename: '/ui',
  },
)
