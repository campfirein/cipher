import {HomePage} from '../pages/home-page'
import {ConnectionBadge} from './connection-badge'
import {Sidebar} from './sidebar'
import {StatusBar} from './status-bar'

export function MainLayout() {
  return (
    <div className="grid grid-cols-[18rem_minmax(0,1fr)] min-h-screen">
      <Sidebar />
      <div className="grid grid-rows-[auto_1fr_auto] min-w-0 max-h-screen">
        <header className="flex items-center justify-between gap-4 px-6 pt-5 pb-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold leading-none">Status</h1>
            <p className="text-muted-foreground text-sm">Current project, auth, and context-tree health.</p>
          </div>
          <ConnectionBadge />
        </header>

        <main className="px-6 mb-6 min-w-0 min-h-0 overflow-y-auto">
          <HomePage />
        </main>

        <StatusBar />
      </div>
    </div>
  )
}
