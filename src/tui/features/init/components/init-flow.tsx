/**
 * InitFlow Component
 *
 * Multi-step React wizard for the /init command.
 * State machine: select_team → select_space → select_agent → executing → done
 *
 * 1. Fetch teams → auto-select if only one, otherwise show selection
 * 2. Fetch spaces for selected team → auto-select if only one
 * 3. Show agent search/selection
 * 4. Execute init with progress updates
 */

import {Box, Text} from 'ink'
import React, {useCallback, useEffect, useMemo, useState} from 'react'

import type {InitProgressEvent} from '../../../../shared/transport/events/index.js'
import type {SpaceDTO, TeamDTO} from '../../../../shared/transport/types/dto.js'

import {InitEvents} from '../../../../shared/transport/events/index.js'
import {SelectableList} from '../../../components/selectable-list.js'
import {useTheme} from '../../../hooks/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {useExecuteInit} from '../api/execute-init.js'
import {useGetAgents} from '../api/get-agents.js'
import {useGetInitSpaces} from '../api/get-spaces.js'
import {useGetTeams} from '../api/get-teams.js'

type FlowStep = 'executing' | 'select_agent' | 'select_space' | 'select_team'

interface ListItem {
  description: string
  id: string
  name: string
}

export interface InitFlowProps {
  /** Whether to force re-initialization */
  force?: boolean
  /** Whether the flow is active for keyboard input */
  isActive?: boolean
  /** Called when the flow is cancelled */
  onCancel: () => void
  /** Called when the flow completes */
  onComplete: (message: string) => void
}

/* eslint-disable complexity -- Multi-step wizard with auto-select logic requires this complexity */
export const InitFlow: React.FC<InitFlowProps> = ({force = false, isActive = true, onCancel, onComplete}) => {
  const {
    theme: {colors},
  } = useTheme()
  const [step, setStep] = useState<FlowStep>('select_team')
  const [selectedTeam, setSelectedTeam] = useState<null | TeamDTO>(null)
  const [selectedSpace, setSelectedSpace] = useState<null | SpaceDTO>(null)
  const [progressMessages, setProgressMessages] = useState<string[]>([])
  const [error, setError] = useState<null | string>(null)

  // Fetch teams
  const {data: teamData, isLoading: isLoadingTeams} = useGetTeams()
  const teams = teamData?.teams ?? []

  // Fetch spaces when team is selected
  const {data: spaceData, isLoading: isLoadingSpaces} = useGetInitSpaces({
    queryConfig: {enabled: Boolean(selectedTeam)},
    teamId: selectedTeam?.id ?? '',
  })
  const spaces = spaceData?.spaces ?? []

  // Fetch agents
  const {data: agentData} = useGetAgents()
  const agents = agentData?.agents ?? []

  const executeInitMutation = useExecuteInit()

  // Auto-select team if only one
  useEffect(() => {
    if (step === 'select_team' && !isLoadingTeams && teams.length === 1) {
      setSelectedTeam(teams[0])
      setStep('select_space')
    }
  }, [step, isLoadingTeams, teams])

  // Auto-select space if only one
  useEffect(() => {
    if (step === 'select_space' && selectedTeam && !isLoadingSpaces && spaces.length === 1) {
      setSelectedSpace(spaces[0])
      setStep('select_agent')
    }
  }, [step, selectedTeam, isLoadingSpaces, spaces])

  // No teams/spaces error via effect
  useEffect(() => {
    if (!isLoadingTeams && teams.length === 0 && step === 'select_team') {
      onComplete('No teams found. Please create a team in the ByteRover dashboard.')
    }
  }, [isLoadingTeams, onComplete, step, teams.length])

  useEffect(() => {
    if (step === 'select_space' && selectedTeam && !isLoadingSpaces && spaces.length === 0 && spaceData) {
      onComplete('No spaces found. Please create a space in the ByteRover dashboard.')
    }
  }, [isLoadingSpaces, onComplete, selectedTeam, spaceData, spaces.length, step])

  const teamItems: ListItem[] = useMemo(
    () => teams.map((t) => ({description: '', id: t.id, name: t.displayName})),
    [teams],
  )

  const spaceItems: ListItem[] = useMemo(
    () => spaces.map((s) => ({description: s.isDefault ? '(default)' : '', id: s.id, name: s.name})),
    [spaces],
  )

  const agentItems: ListItem[] = useMemo(() => agents.map((a) => ({description: '', id: a.id, name: a.name})), [agents])

  const handleTeamSelect = useCallback(
    (item: ListItem) => {
      const team = teams.find((t) => t.id === item.id)
      if (team) {
        setSelectedTeam(team)
        setStep('select_space')
      }
    },
    [teams],
  )

  const handleSpaceSelect = useCallback(
    (item: ListItem) => {
      const space = spaces.find((s) => s.id === item.id)
      if (space) {
        setSelectedSpace(space)
        setStep('select_agent')
      }
    },
    [spaces],
  )

  const handleAgentSelect = useCallback(
    async (item: ListItem) => {
      if (!selectedTeam || !selectedSpace) return

      const agent = agents.find((a) => a.id === item.id)
      const connectorType = agent?.defaultConnectorType ?? 'mcp'

      setStep('executing')
      setProgressMessages([])

      // Subscribe to progress events
      const {apiClient} = useTransportStore.getState()
      const unsubscribe = apiClient?.on<InitProgressEvent>(InitEvents.PROGRESS, (data) => {
        setProgressMessages((prev) => [...prev, data.message])
      })

      try {
        await executeInitMutation.mutateAsync({
          agentId: item.id,
          connectorType,
          force,
          spaceId: selectedSpace.id,
          teamId: selectedTeam.id,
        })

        const lines = [
          'Project initialized successfully!',
          'Configuration saved to: .brv/config.json',
          "NOTE: It's recommended to add .brv/ to your .gitignore file.",
        ]
        onComplete(lines.join('\n'))
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : String(error_))
        setStep('select_agent')
      } finally {
        unsubscribe?.()
      }
    },
    [agents, executeInitMutation, force, onComplete, selectedSpace, selectedTeam],
  )

  // Loading teams
  if (isLoadingTeams) {
    return (
      <Box>
        <Text color={colors.dimText}>Fetching teams...</Text>
      </Box>
    )
  }

  switch (step) {
    case 'executing': {
      return (
        <Box flexDirection="column">
          <Text color={colors.primary}>Initializing project...</Text>
          {progressMessages.map((msg, i) => (
            <Text color={colors.dimText} key={i}>
              {msg}
            </Text>
          ))}
        </Box>
      )
    }

    case 'select_agent': {
      return (
        <Box flexDirection="column">
          {error && (
            <Box marginBottom={1}>
              <Text color={colors.errorText}>{error}</Text>
            </Box>
          )}
          <Box marginBottom={1}>
            <Text color={colors.dimText}>
              Team: {selectedTeam?.displayName} · Space: {selectedSpace?.name}
            </Text>
          </Box>
          <SelectableList<ListItem>
            filterKeys={(item) => [item.id, item.name]}
            getCurrentKey={(item) => item.id}
            isActive={isActive}
            items={agentItems}
            keyExtractor={(item) => item.id}
            onCancel={() => {
              setSelectedSpace(null)
              setStep('select_space')
            }}
            onSelect={handleAgentSelect}
            renderItem={(item, isHighlighted) => (
              <Text backgroundColor={isHighlighted ? colors.dimText : undefined} color={colors.text}>
                {item.name}
              </Text>
            )}
            searchPlaceholder="Search agents..."
            title="Which agent are you using?"
          />
        </Box>
      )
    }

    case 'select_space': {
      if (isLoadingSpaces) {
        return (
          <Box>
            <Text color={colors.dimText}>Fetching spaces...</Text>
          </Box>
        )
      }

      return (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={colors.dimText}>Team: {selectedTeam?.displayName}</Text>
          </Box>
          <SelectableList<ListItem>
            filterKeys={(item) => [item.id, item.name]}
            getCurrentKey={(item) => item.id}
            isActive={isActive}
            items={spaceItems}
            keyExtractor={(item) => item.id}
            onCancel={() => {
              setSelectedTeam(null)
              setStep('select_team')
            }}
            onSelect={handleSpaceSelect}
            renderItem={(item, isHighlighted) => (
              <Box gap={2}>
                <Text backgroundColor={isHighlighted ? colors.dimText : undefined} color={colors.text}>
                  {item.name}
                </Text>
                {item.description && <Text color={colors.dimText}>{item.description}</Text>}
              </Box>
            )}
            title="Select a space"
          />
        </Box>
      )
    }

    case 'select_team': {
      return (
        <SelectableList<ListItem>
          filterKeys={(item) => [item.id, item.name]}
          getCurrentKey={(item) => item.id}
          isActive={isActive}
          items={teamItems}
          keyExtractor={(item) => item.id}
          onCancel={onCancel}
          onSelect={handleTeamSelect}
          renderItem={(item, isHighlighted) => (
            <Text backgroundColor={isHighlighted ? colors.dimText : undefined} color={colors.text}>
              {item.name}
            </Text>
          )}
          title="Select a team"
        />
      )
    }

    default: {
      return null
    }
  }
}
