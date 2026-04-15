import {AuthMenu} from '../features/auth/components/auth-menu'
import {ProjectDropdown} from '../features/project/components/project-dropdown'

export function Sidebar() {
  return (
    <aside className="flex flex-col gap-6 p-6 border-r border-sidebar-border bg-sidebar">
      <div className="flex flex-col gap-2">
        <span className="text-xs tracking-widest uppercase text-muted-foreground">ByteRover Web UI</span>
        <h1 className="text-3xl leading-none">Control Room</h1>
        <ProjectDropdown />

        <AuthMenu />
      </div>
    </aside>
  )
}
