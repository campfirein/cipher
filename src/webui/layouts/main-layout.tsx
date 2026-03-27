import {Outlet, useLocation} from 'react-router-dom'

import {ConnectionBadge} from './connection-badge'
import {Sidebar} from './sidebar'
import {StatusBar} from './status-bar'

const titleMap: Record<string, {subtitle: string; title: string}> = {
  '/analytics': {
    subtitle: 'Activity summaries and what is still waiting on task-store wiring.',
    title: 'Analytics',
  },
  '/connectors': {
    subtitle: 'Install and switch agent integration modes.',
    title: 'Connectors',
  },
  '/hub': {
    subtitle: 'Browse shared skills and manage registry sources.',
    title: 'Hub',
  },
  '/models': {
    subtitle: 'Review the active provider catalog and switch models.',
    title: 'Models',
  },
  '/providers': {
    subtitle: 'Connect accounts, rotate credentials, and change the active provider.',
    title: 'Providers',
  },
  '/session': {
    subtitle: 'Reset context or begin a fresh conversation session.',
    title: 'Session',
  },
  '/spaces': {
    subtitle: 'Inspect available spaces and switch the current workspace.',
    title: 'Spaces',
  },
  '/status': {
    subtitle: 'Current project, auth, and context-tree health.',
    title: 'Status',
  },
  '/sync': {
    subtitle: 'Push to or pull from ByteRover memory storage.',
    title: 'Sync',
  },
}

export function MainLayout() {
  const location = useLocation()
  const page = titleMap[location.pathname] ?? titleMap['/status']

  return (
    <div className="grid grid-cols-[18rem_minmax(0,1fr)] min-h-screen">
      <Sidebar />
      <div className="grid grid-rows-[auto_1fr_auto] min-w-0">
        <header className="flex items-center justify-between gap-4 px-6 pt-5 pb-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold leading-none">{page.title}</h1>
            <p className="text-muted-foreground text-sm">{page.subtitle}</p>
          </div>
          <ConnectionBadge />
        </header>

        <main className="px-6 pb-6 min-w-0">
          <Outlet />
        </main>

        <StatusBar />
      </div>
    </div>
  )
}
