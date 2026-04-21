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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@campfirein/byterover-packages/components/dropdown-menu'
import {ArrowRightLeft, ChevronDown, FolderOpen, SquareArrowOutUpRight} from 'lucide-react'
import {useMemo, useState} from 'react'

import {ProjectLocationDTO} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'
import {useGetEnvironmentConfig} from '../../config/api/get-environment-config'
import {useGetProjectConfig} from '../api/get-project-config'
import {useGetProjectList} from '../api/get-project-list'
import {buildRemoteSpaceUrl} from '../utils/build-remote-space-url'
import {displayPath} from '../utils/display-path'
import {getProjectName} from '../utils/project-name'
import {AllProjectsDialog} from './all-projects-dialog'
import {ProjectAvatar} from './project-avatar'

const RECENT_LIMIT = 5

type ProjectItemProps = {
  onSelect: () => void
  project: ProjectLocationDTO
  /**
   * Fetch + show "Linked to <team> / <space>" — only worth doing for open
   * projects since the daemon won't have warm config caches for unopened ones.
   */
  showRemote?: boolean
}

type ProjectItemRowProps = {
  name: string
  project: ProjectLocationDTO
  remoteLabel?: string
}

function ProjectItemRow({name, project, remoteLabel}: ProjectItemRowProps) {
  return (
    <>
      <ProjectAvatar name={name} seed={project.projectPath} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium leading-5 text-card-foreground!">{name}</span>
        <span className="truncate text-xs leading-4 text-muted-foreground!">{displayPath(project.projectPath)}</span>
        {remoteLabel && (
          <span className="text-muted-foreground! mono flex items-start gap-1 text-[10px] leading-4">
            <span className="min-w-0 wrap-break-word">
              <span>Remote space: </span>
              <span className="text-primary-foreground! font-medium">{remoteLabel}</span>
            </span>
          </span>
        )}
      </div>
    </>
  )
}

function ProjectItem({onSelect, project, showRemote = false}: ProjectItemProps) {
  const name = getProjectName(project.projectPath)
  const {data: projectConfig} = useGetProjectConfig({
    projectPath: project.projectPath,
    queryConfig: {enabled: showRemote},
  })
  const teamName = projectConfig?.brvConfig?.teamName
  const spaceName = projectConfig?.brvConfig?.spaceName
  const remoteLabel = teamName && spaceName ? `${teamName} / ${spaceName}` : undefined

  return (
    <DropdownMenuItem className="gap-2 rounded-md" onClick={onSelect}>
      <ProjectItemRow name={name} project={project} remoteLabel={remoteLabel} />
    </DropdownMenuItem>
  )
}

type OpenProjectItemProps = {
  isSelected: boolean
  onSelect: () => void
  project: ProjectLocationDTO
}

function OpenProjectItem({isSelected, onSelect, project}: OpenProjectItemProps) {
  const name = getProjectName(project.projectPath)
  const {data: projectConfig} = useGetProjectConfig({projectPath: project.projectPath})
  const {data: envConfig} = useGetEnvironmentConfig()
  const teamName = projectConfig?.brvConfig?.teamName
  const spaceName = projectConfig?.brvConfig?.spaceName
  const remoteLabel = teamName && spaceName ? `${teamName} / ${spaceName}` : undefined
  const remoteSpaceUrl = buildRemoteSpaceUrl({spaceName, teamName, webAppUrl: envConfig?.webAppUrl})

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2 rounded-md">
        <ProjectItemRow name={name} project={project} remoteLabel={remoteLabel} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-56">
        <DropdownMenuItem disabled={isSelected} onClick={onSelect}>
          <ArrowRightLeft className="size-4" />
          <span className="text-sm">{isSelected ? 'Current project' : 'Switch to this project'}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!remoteSpaceUrl}
          onClick={() => {
            if (remoteSpaceUrl) window.open(remoteSpaceUrl, '_blank', 'noopener,noreferrer')
          }}
        >
          <SquareArrowOutUpRight className="size-4" />
          <span className="text-sm">Open Remote space</span>
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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

  const projectName = getProjectName(selectedProject)

  function handleSelect(project: ProjectLocationDTO) {
    if (project.projectPath === selectedProject) return
    setSelectedProject(project.projectPath)
  }

  return (
    <>
      <DropdownMenu onOpenChange={setIsOpen} open={isOpen}>
        <DropdownMenuTrigger render={<Button variant="ghost" />}>
          {selectedProject ? <ProjectAvatar name={projectName} seed={selectedProject} size="sm" /> : null}
          <span className="truncate">{projectName || 'No project selected'}</span>
          <ChevronDown className="size-4 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--anchor-width) min-w-72" sideOffset={6}>
          <DropdownMenuItem onClick={() => setIsHintOpen(true)}>
            <FolderOpen className="size-4" />
            <span className="text-sm">Open Project</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          {openProjects.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Open Projects</DropdownMenuLabel>
              {openProjects.map((p) => (
                <OpenProjectItem
                  isSelected={p.projectPath === selectedProject}
                  key={p.projectPath}
                  onSelect={() => handleSelect(p)}
                  project={p}
                />
              ))}

              <DropdownMenuSeparator />
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
                  <span className="text-xs">See all</span>
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
