import { Button } from '@campfirein/byterover-packages/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@campfirein/byterover-packages/components/dialog'
import { Input } from '@campfirein/byterover-packages/components/input'
import { Check, LoaderCircle, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { AgentDTO, ConnectorDTO } from '../../../../shared/transport/types/dto'

import { agentIcons } from './agent-icons'

interface AddConnectorDialogProps {
  agents: AgentDTO[]
  connectors: ConnectorDTO[]
  onAdd: (agent: AgentDTO) => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
  pendingAgentId?: string
}

export function AddConnectorDialog({ agents, connectors, onAdd, onOpenChange, open, pendingAgentId }: AddConnectorDialogProps) {
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const connectedAgentIds = useMemo(() => new Set(connectors.map((c) => c.agent)), [connectors])

  const filtered = useMemo(() => {
    if (!search) return agents
    const q = search.toLowerCase()
    return agents.filter((a) => a.name.toLowerCase().includes(q))
  }, [agents, search])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-150 flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add connector</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="relative shrink-0">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              className="pl-9"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents..."
              value={search}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.map((agent) => {
              const isConnected = connectedAgentIds.has(agent.id)
              const isPending = pendingAgentId === agent.id

              return (
                <div
                  className="flex items-center justify-between rounded px-3 py-2.5"
                  key={agent.id}
                >
                  <div className="flex items-center gap-3">
                    {agentIcons[agent.name] ? (
                      <img alt="" className="size-5 shrink-0" src={agentIcons[agent.name]} />
                    ) : (
                      <div className="size-5 shrink-0" />
                    )}
                    <span className="text-foreground text-sm">{agent.name}</span>
                  </div>
                  <div className="flex size-8 shrink-0 items-center justify-center">
                    {isPending ? (
                      <LoaderCircle className="text-muted-foreground size-4 animate-spin" />
                    ) : isConnected ? (
                      <Check className="text-primary size-4" />
                    ) : (
                      <Button className="size-8" onClick={() => onAdd(agent)} size="icon-sm" variant="outline">
                        <Plus className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}

            {filtered.length === 0 && (
              <p className="text-muted-foreground py-8 text-center text-sm">No agents found</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
