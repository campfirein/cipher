import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@campfirein/byterover-packages/components/dialog'
import {Input} from '@campfirein/byterover-packages/components/input'
import {Search} from 'lucide-react'
import {useMemo, useState} from 'react'

import {ProjectLocationDTO} from '../../../../shared/transport/events'
import {ProjectRow} from './project-row'

type AllProjectsDialogProps = {
  onOpenChange: (open: boolean) => void
  onSelect: (project: ProjectLocationDTO) => void
  open: boolean
  projects: ProjectLocationDTO[]
}

export function AllProjectsDialog({onOpenChange, onSelect, open, projects}: AllProjectsDialogProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) => p.projectPath.toLowerCase().includes(q))
  }, [projects, query])

  function handleSelect(project: ProjectLocationDTO) {
    onSelect(project)
    onOpenChange(false)
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-2 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>All projects</DialogTitle>
          <DialogDescription>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-9"
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                value={query}
              />
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 no-scrollbar max-h-[60vh] min-h-[200px] overflow-y-auto px-4 mt-2">
          {filtered.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">No projects match your search.</p>
          ) : (
            filtered.map((p) => <ProjectRow key={p.projectPath} onClick={() => handleSelect(p)} project={p} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
