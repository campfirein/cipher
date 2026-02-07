/**
 * ConnectorsFlow Component
 *
 * Multi-step React flow for the /connector command.
 * State machine: list → search_agent → select_type → confirm | installing → done
 *
 * 1. Shows installed connectors + "Add new agent" option
 * 2a. If existing selected → show connector type options → confirm switch → install
 * 2b. If "add new" selected → search agent list → select connector type → install
 */

import chalk from 'chalk'
import {Box, Text} from 'ink'
import React, {useCallback, useMemo, useState} from 'react'

import type {AgentDTO, ConnectorDTO} from '../../../../shared/transport/types/dto.js'
import type {Agent} from '../../../../shared/types/agent.js'
import type {ConnectorType} from '../../../../shared/types/connector-type.js'

import {useTheme} from '../../../hooks/index.js'
import {useGetAgents} from '../api/get-agents.js'
import {useGetConnectors} from '../api/get-connectors.js'
import {useInstallConnector} from '../api/install-connector.js'
import {getConnectorName} from '../utils/get-connector-name.js'
import {AgentSearchStep} from './agent-search-step.js'
import {ConfirmSwitchStep} from './confirm-switch-step.js'
import {ConnectorListStep} from './connector-list-step.js'
import {ConnectorTypeStep} from './connector-type-step.js'

type FlowStep = 'confirm_switch' | 'installing' | 'list' | 'search_agent' | 'select_type'

/**
 * Selection can be either:
 * - An existing connector (for switching types)
 * - A new agent (for first-time installation)
 */
type Selection =
  | {agent: AgentDTO; kind: 'new_agent'}
  | {connector: ConnectorDTO; kind: 'existing'; newType?: ConnectorType}

export interface ConnectorsFlowProps {
  isActive?: boolean
  onCancel: () => void
  onComplete: (message: string) => void
}

export const ConnectorsFlow: React.FC<ConnectorsFlowProps> = ({isActive = true, onCancel, onComplete}) => {
  const {
    theme: {colors},
  } = useTheme()
  const [step, setStep] = useState<FlowStep>('list')
  const [selection, setSelection] = useState<null | Selection>(null)
  const [error, setError] = useState<null | string>(null)

  const {data: connectorsData, isLoading: isLoadingConnectors} = useGetConnectors()
  const {data: agentsData, isLoading: isLoadingAgents} = useGetAgents()
  const installMutation = useInstallConnector()

  const connectors = connectorsData?.connectors ?? []
  const allAgents = agentsData?.agents ?? []
  const isLoading = isLoadingConnectors || isLoadingAgents

  // Filter out already-connected agents
  const availableAgents = useMemo(() => {
    const connected = new Set(connectors.map((c) => c.agent))
    return allAgents.filter((a) => !connected.has(a.id))
  }, [connectors, allAgents])

  // --- Handlers ---

  const handleSelectConnector = useCallback((connector: ConnectorDTO) => {
    setSelection({connector, kind: 'existing'})
    setStep('select_type')
  }, [])

  const handleAddNew = useCallback(() => {
    setStep('search_agent')
  }, [])

  const handleSelectAgent = useCallback((agent: AgentDTO) => {
    setSelection({agent, kind: 'new_agent'})
    setStep('select_type')
  }, [])

  const handleSelectType = useCallback(
    async (connectorType: ConnectorType) => {
      if (!selection) return

      if (selection.kind === 'existing') {
        // Same type selected - go back
        if (connectorType === selection.connector.connectorType) {
          setStep('list')
          return
        }

        // Confirm before switching
        setSelection({...selection, newType: connectorType})
        setStep('confirm_switch')
        return
      }

      // New agent - install directly
      await installConnector(selection.agent.id, selection.agent.name, connectorType)
    },
    [selection],
  )

  const handleConfirmSwitch = useCallback(
    async (confirmed: boolean) => {
      if (!selection || selection.kind !== 'existing' || !selection.newType) {
        setStep('list')
        return
      }

      if (!confirmed) {
        onComplete(
          `Kept ${selection.connector.agent} connected via ${getConnectorName(selection.connector.connectorType)}`,
        )
        return
      }

      await installConnector(
        selection.connector.agent,
        selection.connector.agent,
        selection.newType,
        selection.connector.connectorType,
      )
    },
    [selection, onComplete],
  )

  const handleCancelTypeSelection = useCallback(() => {
    if (selection?.kind === 'new_agent') {
      setSelection(null)
      setStep('search_agent')
    } else {
      setSelection(null)
      setStep('list')
    }
  }, [selection])

  // --- Install Logic ---

  async function installConnector(
    agentId: Agent,
    agentName: Agent,
    connectorType: ConnectorType,
    fromType?: ConnectorType,
  ) {
    setStep('installing')
    try {
      const result = await installMutation.mutateAsync({agentId, connectorType})

      if (result.success) {
        const statusMessage = fromType
          ? `${agentName} switched from ${getConnectorName(fromType)} to ${getConnectorName(connectorType)}`
          : `${agentName} connected via ${getConnectorName(connectorType)}`
        const prompt = chalk.hex('#0AA77D').italic('> "Save our API authentication patterns, use brv curate"')
        const message = `${statusMessage}

WHAT'S NEXT
Try this in your next prompt:
${prompt}
Docs: https://docs.byterover.dev/common-workflows/curate-context`
        onComplete(message)
      } else {
        setError(result.message ?? `Failed to configure ${agentName}`)
        setStep('list')
      }
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_))
      setStep('list')
    }
  }

  // --- Render Helpers ---

  function renderSelectTypeStep() {
    if (!selection) return null

    const isExisting = selection.kind === 'existing'
    const agentName = isExisting ? selection.connector.agent : selection.agent.name
    const supportedTypes = isExisting ? selection.connector.supportedTypes : selection.agent.supportedConnectorTypes
    const defaultType = isExisting ? selection.connector.defaultType : selection.agent.defaultConnectorType
    const currentType = isExisting ? selection.connector.connectorType : undefined

    return (
      <ConnectorTypeStep
        agentName={agentName}
        currentType={currentType}
        defaultType={defaultType}
        isActive={isActive}
        onCancel={handleCancelTypeSelection}
        onSelect={handleSelectType}
        supportedTypes={supportedTypes}
      />
    )
  }

  // --- Render ---

  if (isLoading) {
    return (
      <Box>
        <Text color={colors.dimText}>Loading connectors...</Text>
      </Box>
    )
  }

  switch (step) {
    case 'confirm_switch': {
      if (!selection || selection.kind !== 'existing' || !selection.newType) return null

      return (
        <ConfirmSwitchStep
          agentName={selection.connector.agent}
          fromType={selection.connector.connectorType}
          isActive={isActive}
          onConfirm={handleConfirmSwitch}
          toType={selection.newType}
        />
      )
    }

    case 'installing': {
      return (
        <Box>
          <Text color={colors.primary}>Installing connector...</Text>
        </Box>
      )
    }

    case 'list': {
      return (
        <ConnectorListStep
          connectors={connectors}
          error={error}
          isActive={isActive}
          onAddNew={handleAddNew}
          onCancel={onCancel}
          onSelectConnector={handleSelectConnector}
        />
      )
    }

    case 'search_agent': {
      return (
        <AgentSearchStep
          agents={availableAgents}
          isActive={isActive}
          onCancel={() => setStep('list')}
          onSelect={handleSelectAgent}
        />
      )
    }

    case 'select_type': {
      return renderSelectTypeStep()
    }

    default: {
      return null
    }
  }
}
