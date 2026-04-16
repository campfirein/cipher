import {ProjectLocationDTO} from '../../../../shared/transport/events'
import {displayPath} from '../utils/display-path'
import {getProjectName} from '../utils/project-name'
import {ProjectAvatar} from './project-avatar'

export function ProjectRow({onClick, project}: {onClick: () => void; project: ProjectLocationDTO}) {
  const name = getProjectName(project.projectPath)

  return (
    <button
      className="flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-accent cursor-pointer"
      onClick={onClick}
      type="button"
    >
      <ProjectAvatar name={name} seed={project.projectPath} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium leading-5 text-card-foreground">{name}</span>
        <span className="truncate text-xs leading-4 text-muted-foreground">{displayPath(project.projectPath)}</span>
      </div>
    </button>
  )
}
