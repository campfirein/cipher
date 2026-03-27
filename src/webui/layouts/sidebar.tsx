import { NavLink } from 'react-router-dom'

type NavItem = {
  description: string
  path: string
  title: string
}

type NavGroup = {
  items: NavItem[]
  title: string
}

const navGroups: NavGroup[] = [
  {
    items: [
      { description: 'Daemon health and project context', path: '/status', title: 'Status' },
      { description: 'Local task metrics placeholder', path: '/analytics', title: 'Analytics' },
    ],
    title: 'Monitor',
  },
  {
    items: [
      { description: 'LLM accounts and authentication', path: '/providers', title: 'Providers' },
      { description: 'Pick the active model', path: '/models', title: 'Models' },
      { description: 'Install agent integrations', path: '/connectors', title: 'Connectors' },
      { description: 'Browse hub entries and registries', path: '/hub', title: 'Hub' },
    ],
    title: 'Configuration',
  },
  {
    items: [
      { description: 'Push and pull context trees', path: '/sync', title: 'Sync' },
      { description: 'Switch the active ByteRover space', path: '/spaces', title: 'Spaces' },
    ],
    title: 'Workspace',
  },
  {
    items: [{ description: 'Fresh session and reset controls', path: '/session', title: 'Session' }],
    title: 'Session',
  },
]

export function Sidebar() {
  return (
    <aside className="flex flex-col gap-6 p-6 border-r border-sidebar-border bg-sidebar">
      <div className="flex flex-col gap-1">
        <span className="text-xs tracking-widest uppercase text-muted-foreground">ByteRover Web UI</span>
        <h1 className="text-3xl leading-none">Control Room</h1>
        <p className="text-muted-foreground text-sm">The TUI features, reorganized into durable web panels.</p>
      </div>

      {navGroups.map((group) => (
        <section className="flex flex-col gap-2" key={group.title}>
          <h2 className="text-xs tracking-widest uppercase text-muted-foreground">{group.title}</h2>
          <nav className="flex flex-col gap-1">
            {group.items.map((item) => (
              <NavLink
                className={({ isActive }) =>
                  isActive ? 'block px-3 py-2.5 rounded-lg no-underline text-foreground bg-primary border border-sidebar-border' : 'block px-3 py-2.5 border border-transparent rounded-lg no-underline text-muted-foreground transition-all duration-150 hover:text-foreground hover:border-border hover:bg-accent'
                }
                key={item.path}
                to={item.path}
              >
                <strong>{item.title}</strong>
                <div className='text-sm'>{item.description}</div>
              </NavLink>
            ))}
          </nav>
        </section>
      ))}
    </aside>
  )
}
