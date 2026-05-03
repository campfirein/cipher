import {Button} from '@campfirein/byterover-packages/components/button'
import {Skeleton} from '@campfirein/byterover-packages/components/skeleton'
import {LoaderCircle, Plus} from 'lucide-react'
import {useState} from 'react'
import {toast} from 'sonner'

import type {Agent} from '../../../../shared/types/agent'

import {useGetAgents} from '../api/get-agents'
import {useGetConnectors} from '../api/get-connectors'
import {useInstallBundle} from '../api/install-bundle'
import {AddConnectorDialog} from './add-connector-dialog'
import {agentIcons} from './agent-icons'

export function ConnectorsPanel() {
  const {data: connectorsData, isLoading: isLoadingConnectors} = useGetConnectors()
  const {data: agentsData, isLoading: isLoadingAgents} = useGetAgents()
  const installMutation = useInstallBundle()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [pendingAgentId, setPendingAgentId] = useState<string | undefined>()

  const connectors = connectorsData?.connectors ?? []
  const agents = agentsData?.agents ?? []
  const isLoading = isLoadingConnectors || isLoadingAgents

  const handleAddConnector = async (agentId: Agent) => {
    try {
      const result = await installMutation.mutateAsync({agentId})
      if (!result.success) {
        toast.error(result.message)
        return
      }

      const installed = result.installed.length
      const skipped = result.skipped.length
      toast.success(
        skipped > 0
          ? `Connected ${agentId}. Installed ${installed} artifact(s); ${skipped} skipped.`
          : `Connected ${agentId}. Installed ${installed} artifact(s).`,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to connect agent')
    }
  }

  return (
    <div className="flex w-full flex-col gap-5">
      {/* Title + Add button */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-foreground text-[0.95rem] font-semibold leading-tight">Connectors</h2>
          <p className="text-muted-foreground mt-0.5 text-[0.8125rem] leading-snug">
            Manage how AI agents connect to ByteRover.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isLoading && <LoaderCircle className="text-muted-foreground size-4 animate-spin" />}
          <Button disabled={isLoading} onClick={() => setAddDialogOpen(true)} size="sm" variant="outline">
            <Plus strokeWidth={3} /> Add connector
          </Button>
        </div>
      </div>

      <AddConnectorDialog
        agents={agents}
        connectors={connectors}
        onAdd={async (agent) => {
          setPendingAgentId(agent.id)
          try {
            await handleAddConnector(agent.id)
          } finally {
            setPendingAgentId(undefined)
          }
        }}
        onOpenChange={setAddDialogOpen}
        open={addDialogOpen}
        pendingAgentId={pendingAgentId}
      />

      {/* Connector list */}
      {isLoading ? (
        <div className="bg-card border rounded-xl px-6 py-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-5 shrink-0 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-8 w-16 shrink-0" />
          </div>
        </div>
      ) : connectors.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No connectors installed. Add one to get started.
        </p>
      ) : (
        <div className="bg-card border rounded-xl px-6 py-5 flex flex-col gap-4">
          {connectors.map((connector, index) => (
            <div className="flex flex-col gap-4" key={connector.agent}>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3 text-sm">
                  {agentIcons[connector.agent] ? (
                    <img alt="" className="size-5 shrink-0" src={agentIcons[connector.agent]} />
                  ) : (
                    <div className="size-5 shrink-0" />
                  )}
                  <div className="flex flex-col">
                    <span>{connector.agent}</span>
                    <span className="text-primary text-xs">Connected</span>
                  </div>
                </div>
              </div>
              {index < connectors.length - 1 && <div className="border-b" />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
