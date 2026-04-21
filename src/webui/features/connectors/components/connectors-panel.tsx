import { Button } from '@campfirein/byterover-packages/components/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@campfirein/byterover-packages/components/dropdown-menu'
import { ChevronDown, LoaderCircle, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import type { ConnectorDTO } from '../../../../shared/transport/types/dto'
import type { Agent } from '../../../../shared/types/agent'
import type { ConnectorType } from '../../../../shared/types/connector-type'

import { requiresAgentRestart } from '../../../../shared/types/connector-type'
import { useGetAgents } from '../api/get-agents'
import { useGetConnectors } from '../api/get-connectors'
import { useInstallConnector } from '../api/install-connector'
import { AddConnectorDialog } from './add-connector-dialog'
import { agentIcons } from './agent-icons'

const connectorLabels: Record<ConnectorType, string> = {
  hook: 'Hook',
  mcp: 'MCP',
  rules: 'Rules',
  skill: 'Skill',
}

export function ConnectorsPanel() {
  const { data: connectorsData, isLoading: isLoadingConnectors } = useGetConnectors()
  const { data: agentsData, isLoading: isLoadingAgents } = useGetAgents()
  const installMutation = useInstallConnector()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [pendingAgentId, setPendingAgentId] = useState<string | undefined>()

  const connectors = connectorsData?.connectors ?? []
  const agents = agentsData?.agents ?? []
  const isLoading = isLoadingConnectors || isLoadingAgents

  const handleTypeChange = async (connector: ConnectorDTO, newType: ConnectorType) => {
    if (newType === connector.connectorType) return

    try {
      await installMutation.mutateAsync({ agentId: connector.agent, connectorType: newType })
      const needsRestart = requiresAgentRestart(newType)
      toast.success(
        needsRestart
          ? `${connector.agent} switched to ${connectorLabels[newType]}. Restart the agent to apply.`
          : `${connector.agent} switched to ${connectorLabels[newType]}.`,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to switch connector type')
    }
  }

  const handleAddConnector = async (agentId: Agent, connectorType: ConnectorType) => {
    try {
      await installMutation.mutateAsync({ agentId, connectorType })
      toast.success(`${agentId} connected via ${connectorLabels[connectorType]}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to install connector')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoaderCircle className="text-muted-foreground size-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 w-full sm:max-w-lg md:max-w-xl lg:max-w-2xl">
      {/* Title + Add button */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-foreground text-lg font-bold">Connectors</h2>
          <p className="text-muted-foreground text-sm">Manage how AI agents connect to ByteRover.</p>
        </div>

        <Button onClick={() => setAddDialogOpen(true)} variant="default">
          <Plus strokeWidth={3} /> Add connector
        </Button>
      </div>

      <AddConnectorDialog
        agents={agents}
        connectors={connectors}
        onAdd={async (agent) => {
          setPendingAgentId(agent.id)
          try {
            await handleAddConnector(agent.id, agent.defaultConnectorType)
          } finally {
            setPendingAgentId(undefined)
          }
        }}
        onOpenChange={setAddDialogOpen}
        open={addDialogOpen}
        pendingAgentId={pendingAgentId}
      />

      {/* Connector list */}
      {connectors.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">No connectors installed. Add one to get started.</p>
      ) : (
        <div className='border rounded-xl px-6 py-5 flex flex-col gap-4'>{
          connectors.map((connector, index) => (
            <div className='flex flex-col gap-4' key={connector.agent}>
              <div className='flex justify-between items-center'>
                <div className='flex items-center gap-3 text-sm'>
                  {agentIcons[connector.agent] ? (
                    <img alt="" className="size-5 shrink-0" src={agentIcons[connector.agent]} />
                  ) : (
                    <div className="size-5 shrink-0" />
                  )}
                  <div className='flex flex-col'>
                    <span>{connector.agent}</span>
                    <span className='text-primary text-xs'>Connected</span>
                  </div>
                </div>
                <div className='flex items-center'>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={installMutation.isPending}
                      render={<Button className="text-sm" disabled={installMutation.isPending} size="sm" variant="outline" />}
                    >
                      {connectorLabels[connector.connectorType]}
                      <ChevronDown className="size-3.5 shrink-0" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      {connector.supportedTypes.map((type) => (
                        <DropdownMenuItem key={type} onClick={() => handleTypeChange(connector, type)}>
                          {connectorLabels[type]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              {index < connectors.length - 1 && <div className='border-b' />}
            </div>
          ))
        }</div>
      )}
    </div>
  )
}
