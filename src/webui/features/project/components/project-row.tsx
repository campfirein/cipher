import {ProjectLocationDTO} from '../../../../shared/transport/events'
import {avatarColor} from '../utils/avatar-color'
import {displayPath} from '../utils/display-path'
import {initials} from '../utils/initials'

export function ProjectRow({onClick, project}: {onClick: () => void; project: ProjectLocationDTO}) {
  const name = project.projectPath.split('/').at(-1) ?? project.projectPath
  const color = avatarColor(project.projectPath)

  return (
    <button
      className="flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-accent cursor-pointer"
      onClick={onClick}
      type="button"
    >
      <div
        className="flex size-7 shrink-0 items-center justify-center rounded text-xs font-extrabold leading-4 text-background"
        style={{backgroundColor: color}}
      >
        {initials(name)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium leading-5 text-card-foreground">{name}</span>
        <span className="truncate text-xs leading-4 text-muted-foreground">{displayPath(project.projectPath)}</span>
      </div>
    </button>
  )
}
