import { Alert, AlertAction, AlertDescription, AlertTitle } from '@campfirein/byterover-packages/components/alert'
import { Badge } from '@campfirein/byterover-packages/components/badge'
import { Button } from '@campfirein/byterover-packages/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@campfirein/byterover-packages/components/card'
import { Input } from '@campfirein/byterover-packages/components/input'
import { Tabs, TabsList, TabsTrigger } from '@campfirein/byterover-packages/components/tabs'
import { useDeferredValue, useEffect, useState } from 'react'

import type { AgentDTO, ConnectorDTO } from '../../../../shared/transport/types/dto'
import type { ConnectorType } from '../../../../shared/types/connector-type'

import { CONNECTOR_TYPES, requiresAgentRestart } from '../../../../shared/types/connector-type'
import { useGetAgentConfigPaths } from '../api/get-agent-config-paths'
import { useGetAgents } from '../api/get-agents'
import { useGetConnectors } from '../api/get-connectors'
import { useInstallConnector } from '../api/install-connector'

const connectorLabels: Record<ConnectorType, string> = {
  hook: 'Hook',
  mcp: 'MCP',
  rules: 'Rules',
  skill: 'Skill',
}

type Feedback = {
  details?: string
  text: string
  tone: 'error' | 'info' | 'success'
}

export function ConnectorsPanel() {
  const [activeTab, setActiveTab] = useState<ConnectorType>('rules')
  const [selectedAgentId, setSelectedAgentId] = useState<AgentDTO['id'] | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [agentSearch, setAgentSearch] = useState('')
  const deferredAgentSearch = useDeferredValue(agentSearch)

  const { data: connectorsData, error: connectorsError, isLoading: isLoadingConnectors, refetch: refetchConnectors } = useGetConnectors()
  const { data: agentsData, error: agentsError, isLoading: isLoadingAgents } = useGetAgents()
  const installMutation = useInstallConnector()

  const connectors = connectorsData?.connectors ?? []
  const agents = agentsData?.agents ?? []
  const connectorByAgent = new Map(connectors.map((connector) => [connector.agent, connector]))
  const visibleAgents = agents
    .filter((agent) => agent.supportedConnectorTypes.includes(activeTab))
    .filter((agent) => !deferredAgentSearch || agent.name.toLowerCase().includes(deferredAgentSearch.toLowerCase()))

  useEffect(() => {
    if (visibleAgents.length === 0) return
    if (selectedAgentId && visibleAgents.some((agent) => agent.id === selectedAgentId)) return
    setSelectedAgentId(visibleAgents[0].id)
  }, [activeTab, selectedAgentId, visibleAgents])

  const configPathsQuery = useGetAgentConfigPaths({
    agentId: (selectedAgentId ?? visibleAgents[0]?.id ?? 'Codex') as AgentDTO['id'],
    queryConfig: { enabled: Boolean(selectedAgentId) },
  })

  async function handleInstall(agent: AgentDTO, existingConnector?: ConnectorDTO) {
    try {
      const result = await installMutation.mutateAsync({ agentId: agent.id, connectorType: activeTab })
      await refetchConnectors()
      setSelectedAgentId(agent.id)

      const needsRestart = existingConnector && requiresAgentRestart(activeTab)
      setFeedback({
        details: needsRestart
          ? undefined
          : result.requiresManualSetup
            ? result.manualInstructions?.configContent
            : result.configPath
              ? `Config path: ${result.configPath}`
              : undefined,
        text: needsRestart
          ? `${agent.name} switched to ${connectorLabels[activeTab]}. Restart the agent to apply the new connector.`
          : result.message,
        tone: needsRestart ? 'info' : 'success',
      })
    } catch (installError) {
      setFeedback({
        text: installError instanceof Error ? installError.message : `Failed to install ${connectorLabels[activeTab]} connector`,
        tone: 'error',
      })
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {feedback ? (
        <Alert className='border-primary' variant={feedback.tone === 'error' ? 'destructive' : 'default'}>
          <AlertTitle>{feedback.text}</AlertTitle>
          {feedback.details ? <AlertDescription>{feedback.details}</AlertDescription> : null}
          <AlertAction>
            <button className="size-6 flex items-center justify-center text-lg leading-none opacity-60 hover:opacity-100 cursor-pointer" onClick={() => setFeedback(null)} type="button">&times;</button>
          </AlertAction>
        </Alert>
      ) : null}

      {isLoadingConnectors || isLoadingAgents ? <div className="p-4 border border-blue-500/20 rounded-xl bg-blue-50 text-blue-700">Loading connectors…</div> : null}

      {connectorsError ? <div className="p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive">{connectorsError.message}</div> : null}

      {agentsError ? <div className="p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive">{agentsError.message}</div> : null}

      <div className="grid gap-4 grid-cols-2 items-start flex-1 min-h-0">
        <Card className="min-h-0 overflow-hidden shadow-sm ring-border/70 h-full" size="sm">
          <CardHeader>
            <div>
              <CardTitle className="font-semibold">Supported agents</CardTitle>
              <CardDescription>{`${visibleAgents.length} agents support ${connectorLabels[activeTab]}.`}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 min-h-0 overflow-hidden">
            <div className="flex items-center gap-3 shrink-0 pt-2">
              <Tabs onValueChange={(value) => setActiveTab(value as ConnectorType)} value={activeTab}>
                <TabsList className="h-10 flex-wrap" variant="default">
                  {CONNECTOR_TYPES.map((connectorType) => (
                    <TabsTrigger className="cursor-pointer px-3" key={connectorType} value={connectorType}>
                      {connectorLabels[connectorType]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <Input
                className="h-10 flex-1 rounded-lg bg-background px-3"
                onChange={(event) => setAgentSearch(event.target.value)}
                placeholder="Search agents by name..."
                value={agentSearch}
              />
            </div>
            <div className="flex flex-col gap-3 overflow-y-auto p-px">
              {visibleAgents.map((agent) => {
                const existingConnector = connectorByAgent.get(agent.id)
                const isSelected = agent.id === selectedAgentId
                const isActiveConnector = existingConnector?.connectorType === activeTab

                return (
                  <Card
                    className={isSelected ? 'shrink-0 cursor-pointer gap-3 px-4 shadow-none ring-primary/30 bg-primary/5' : 'shrink-0 cursor-pointer gap-3 px-4 shadow-none ring-border/80'}
                    key={agent.id}
                    onClick={() => setSelectedAgentId(agent.id)}
                    size="sm"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <CardTitle className="font-semibold">{agent.name}</CardTitle>
                        <CardDescription>
                          Current mode: {existingConnector ? connectorLabels[existingConnector.connectorType] : 'Not installed'}
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap gap-2.5">
                        {isActiveConnector ? <Badge className="rounded-sm border-transparent bg-primary/10 text-primary" variant="outline">Installed</Badge> : null}
                        {isActiveConnector ? null : (
                          <Button className="cursor-pointer text-foreground" onClick={() => handleInstall(agent, existingConnector)} size="lg">
                            {existingConnector ? 'Switch' : 'Install'}
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm ring-border/70" size="sm">
          <CardHeader>
            <div>
              <CardTitle className="font-semibold">Configuration paths</CardTitle>
              <CardDescription>Select an agent to inspect the file locations known by the daemon.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {configPathsQuery.error ? <div className="p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive">{configPathsQuery.error.message}</div> : null}

            <div className="grid grid-cols-2 gap-3">
              {CONNECTOR_TYPES.map((connectorType) => (
                <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" key={connectorType} size="sm">
                  <div className="text-xs tracking-wider uppercase text-muted-foreground">{connectorLabels[connectorType]}</div>
                  <div className="break-words">{configPathsQuery.data?.configPaths[connectorType] ?? 'Not available'}</div>
                </Card>
              ))}
            </div>

            {requiresAgentRestart(activeTab) ? (
              <div className="p-4 border border-yellow-500/20 rounded-xl bg-yellow-50 text-yellow-700">
                {connectorLabels[activeTab]} connectors usually require an agent restart after installation.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
