import {cn} from '@campfirein/byterover-packages/lib/utils'
import {NavLink, Outlet} from 'react-router-dom'

import {Header} from './header'

const tabs = [
  {label: 'Analytics', path: '/analytics'},
  {label: 'Context', path: '/contexts'},
  {label: 'Changes', path: '/sync'},
  {label: 'Configuration', path: '/configuration'},
]

export function MainLayout() {
  return (
    <div className="flex h-screen flex-col">
      <Header />

      {/* Tabs */}
      <nav className="flex gap-1 border-b border-border px-6">
        {tabs.map((tab) => (
          <NavLink
            className={({isActive}) =>
              cn('border-b-2 px-2 pt-2 pb-3 text-sm transition-colors', {
                'border-primary-foreground text-primary-foreground font-medium': isActive,
                'border-transparent text-muted-foreground hover:text-foreground': !isActive,
              })
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
