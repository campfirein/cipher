import { cn } from '@campfirein/byterover-packages/lib/utils'
import { Book } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

import logo from '../assets/logo-byterover.svg'
import { ProjectDropdown } from '../features/project/components/project-dropdown'
import { useTransportStore } from '../stores/transport-store'

const tabs = [
  { label: 'Analytics', path: '/analytics' },
  { label: 'Context', path: '/contexts' },
  { label: 'Changes', path: '/sync' },
  { label: 'Configuration', path: '/connectors' },
]

export function MainLayout() {
  const version = useTransportStore((s) => s.version)

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex items-center gap-4 bg-card px-6 py-3.5">
        {/* Left: logo + project + branch */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <img alt="ByteRover" className="w-32" src={logo} />
            {version && <span className="text-primary-foreground text-xs font-medium">v{version}</span>}
          </div>

          <ProjectDropdown />

          <span className="text-sm">&lt;branch&gt;</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: provider/model + docs + login */}
        <div className="flex items-center gap-2">
          <span className="text-sm">&lt;provider/model&gt;</span>

          <a className="flex items-center gap-1.5 text-xs transition-colors px-2.5 py-2 hover:bg-muted rounded-md" href="https://docs.byterover.dev" rel="noopener noreferrer" target="_blank">
            <Book className="size-4" />
            Docs
          </a>

          <span className="text-sm">&lt;login&gt;</span>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex gap-1 border-b border-border bg-card px-6">
        {tabs.map((tab) => (
          <NavLink
            className={({ isActive }) =>
              cn(
                'border-b-2 px-2 pt-2 pb-3 text-sm transition-colors',
                {
                  'border-primary-foreground text-primary-foreground font-medium': isActive,
                  'border-transparent text-muted-foreground hover:text-foreground': !isActive,
                },
              )
            }
            key={tab.path}
            to={tab.path}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      {/* Content */}
      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        <Outlet />
      </main>
    </div>
  )
}
