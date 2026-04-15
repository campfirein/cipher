import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@campfirein/byterover-packages/components/alert-dialog'
import {Button} from '@campfirein/byterover-packages/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@campfirein/byterover-packages/components/dropdown-menu'
import {ChevronDown, FolderOpen} from 'lucide-react'
import {useMemo, useState} from 'react'

import {ProjectLocationDTO} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'
import {useGetProjectList} from '../api/get-project-list'
import {avatarColor} from '../utils/avatar-color'
import {displayPath} from '../utils/display-path'
import {initials} from '../utils/initials'
import {AllProjectsDialog} from './all-projects-dialog'

const RECENT_LIMIT = 5

type ProjectItemProps = {
  onSelect: () => void
  project: ProjectLocationDTO
}

function ProjectItem({onSelect, project}: ProjectItemProps) {
  const name = project.projectPath.split('/').at(-1) ?? project.projectPath
  const color = avatarColor(project.projectPath)

  return (
    <DropdownMenuItem className="gap-2 rounded-md p-2" onClick={onSelect}>
      <div
        className="flex size-6 shrink-0 items-center justify-center rounded text-xs font-extrabold leading-4 text-background!"
        style={{backgroundColor: color}}
      >
        {initials(name)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium leading-5 text-card-foreground!">{name}</span>
        <span className="truncate text-xs leading-4 text-muted-foreground!">{displayPath(project.projectPath)}</span>
      </div>
    </DropdownMenuItem>
  )
}

export function ProjectDropdown() {
  const selectedProject = useTransportStore((s) => s.selectedProject)
  const setSelectedProject = useTransportStore((s) => s.setSelectedProject)
  const {data: projResp} = useGetProjectList({
    queryConfig: {
      refetchInterval: 3000,
      refetchIntervalInBackground: false,
      staleTime: 30 * 1000,
    },
  })

  const projects = useMemo(() => projResp?.locations ?? [], [projResp])
  const {openProjects, recentProjects} = useMemo(() => {
    const open: ProjectLocationDTO[] = []
    const recent: ProjectLocationDTO[] = []
    for (const p of projects) {
      if (p.isActive) open.push(p)
      else recent.push(p)
    }

    return {openProjects: open, recentProjects: recent}
  }, [projects])

  const [isOpen, setIsOpen] = useState(false)
  const [isHintOpen, setIsHintOpen] = useState(false)
  const [isAllOpen, setIsAllOpen] = useState(false)

  const projectName = selectedProject.split('/').at(-1) ?? selectedProject

  function handleSelect(project: ProjectLocationDTO) {
    if (project.projectPath === selectedProject) return
    setSelectedProject(project.projectPath)
  }

  return (
    <>
      <DropdownMenu onOpenChange={setIsOpen} open={isOpen}>
        <DropdownMenuTrigger>
          <Button size="sm" variant="outline">
            <span className="truncate">{projectName || 'No project selected'}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--anchor-width) min-w-72" sideOffset={6}>
          <DropdownMenuItem onClick={() => setIsHintOpen(true)}>
            <FolderOpen className="size-4 text-muted-foreground!" />
            <span className="text-sm">Open Project</span>
          </DropdownMenuItem>

          {openProjects.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Open Projects</DropdownMenuLabel>
              {openProjects.map((p) => (
                <ProjectItem key={p.projectPath} onSelect={() => handleSelect(p)} project={p} />
              ))}
            </DropdownMenuGroup>
          )}

          {recentProjects.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Recent Projects</DropdownMenuLabel>
              {recentProjects.slice(0, RECENT_LIMIT).map((p) => (
                <ProjectItem key={p.projectPath} onSelect={() => handleSelect(p)} project={p} />
              ))}
              {recentProjects.length > RECENT_LIMIT && (
                <DropdownMenuItem onClick={() => setIsAllOpen(true)}>
                  <span className="text-xs text-muted-foreground!">See all</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog onOpenChange={setIsHintOpen} open={isHintOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add a project</AlertDialogTitle>
            <AlertDialogDescription>
              To add a project, run <code className="rounded bg-muted px-1.5 py-0.5 text-sm">brv webui</code> in that
              folder from your terminal. Once registered, it will appear here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Got it</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AllProjectsDialog onOpenChange={setIsAllOpen} onSelect={handleSelect} open={isAllOpen} projects={projects} />
    </>
  )
}
