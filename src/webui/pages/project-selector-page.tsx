import {useMemo, useState} from 'react'
import {useLocation, useNavigate} from 'react-router-dom'

import {ProjectLocationDTO} from '../../shared/transport/events'
import logoUrl from '../assets/logo.svg'
import {useGetProjectList} from '../features/project/api/get-project-list'
import {AllProjectsDialog} from '../features/project/components/all-projects-dialog'
import {ProjectRow} from '../features/project/components/project-row'
import {useTransportStore} from '../stores/transport-store'

function ByterroverMark() {
  return (
    <div className="flex flex-col items-center gap-2">
      <img alt="Byterover" className="size-10" src={logoUrl} />
      <span className="text-lg font-semibold text-foreground">BYTEROVER</span>
    </div>
  )
}

export function ProjectSelectorPage() {
  const isConnected = useTransportStore((s) => s.isConnected)
  const setSelectedProject = useTransportStore((s) => s.setSelectedProject)
  const version = useTransportStore((s) => s.version)
  const navigate = useNavigate()
  const location = useLocation()
  const fromPath = (location.state as null | {from?: {pathname: string}})?.from?.pathname ?? '/'
  const {data: projResp, isLoading} = useGetProjectList({
    queryConfig: {
      enabled: isConnected,
      refetchInterval: 3000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      staleTime: 30 * 1000,
    },
  })

  const projects = useMemo(() => projResp?.locations ?? [], [projResp])
  const [isAllOpen, setIsAllOpen] = useState(false)

  function handleSelect(project: ProjectLocationDTO) {
    setSelectedProject(project.projectPath)
    navigate(fromPath, {replace: true})
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center">
      <div className="flex w-[400px] flex-col gap-4">
        <div className="flex flex-col items-center gap-2">
          <ByterroverMark />
          <div className="flex items-center justify-center gap-1 text-xs font-medium leading-4">
            <span className="text-muted-foreground">Version {version || '—'}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5 px-2">
            <span className="flex-1 text-xs text-muted-foreground">Recent Projects</span>
            {projects.length > 0 && (
              <button
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
                onClick={() => setIsAllOpen(true)}
                type="button"
              >
                See all
              </button>
            )}
          </div>

          {isLoading && <p className="px-2 py-2 text-xs text-muted-foreground">Loading projects...</p>}

          {!isLoading && projects.length === 0 && (
            <div className="flex flex-col gap-1 px-2 py-2">
              <p className="text-xs text-muted-foreground">No projects found.</p>
              <p className="text-xs text-muted-foreground">
                Run <code className="rounded bg-muted px-1.5 py-0.5 text-sm">brv webui</code> in a project directory to
                get started.
              </p>
            </div>
          )}

          <div className="flex flex-col">
            {projects.slice(0, 5).map((p) => (
              <ProjectRow key={p.projectPath} onClick={() => handleSelect(p)} project={p} />
            ))}
          </div>
        </div>
      </div>

      <AllProjectsDialog onOpenChange={setIsAllOpen} onSelect={handleSelect} open={isAllOpen} projects={projects} />
    </div>
  )
}
