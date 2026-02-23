/**
 * Welcome Box Component
 *
 * Displays welcome message and getting started instructions for new users
 */

import {Box, Spacer, Text} from 'ink'
import React, {useRef} from 'react'

import {useGetModels} from '../../features/model/api/get-models.js'
import {useGetProviders} from '../../features/provider/api/get-providers.js'
import {useTheme} from '../../hooks/index.js'
import {formatTime} from '../../utils/time.js'

export const WelcomeBox: React.FC = () => {
  const {
    theme: {colors},
  } = useTheme()
  const {data: providersData} = useGetProviders()
  const currentProvider = providersData?.providers.find((p) => p.isCurrent)
  const {data: modelsData} = useGetModels({providerId: currentProvider?.id ?? ''})

  const providerName = currentProvider?.name
  const activeModel = modelsData?.activeModel
  const isConnected = Boolean(providerName)

  const timestampRef = useRef(new Date())

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      {/* Header */}
      <Box>
        <Text color={colors.primary}>· agent</Text>
        <Spacer />
        <Text color={colors.dimText}>{formatTime(timestampRef.current)}</Text>
      </Box>
      <Box borderColor={colors.border} borderStyle="single" flexDirection="column" gap={1} paddingX={1}>
        <Text bold color={colors.primary}>
          Welcome to ByteRover.
        </Text>
        <Box flexDirection="column">
          {isConnected && (
            <Text color={colors.text}>
              Connected to <Text color={colors.primary}>{providerName}</Text>
              {activeModel && <Text> (<Text color={colors.primary}>{activeModel}</Text>)</Text>}
              . ByteRover is your Memory Hub for storing and retrieving AI context
            </Text>
          )}
          {!isConnected && (
            <Text color={colors.text}>
              No provider connected. Use <Text color={colors.warning}>/provider</Text> to connect.
            </Text>
          )}
          <Text color={colors.text}> </Text>
          <Text color={colors.text}>COMMANDS REFERENCE:</Text>
          <Text color={colors.text}>-------------------------------------------------------------</Text>
          <Text color={colors.text}>Action        Command       Description</Text>
          <Text color={colors.text}>-------------------------------------------------------------</Text>
          <Text color={colors.text}>STORE         <Text color={colors.warning}>/curate</Text>       Save context or knowledge</Text>
          <Text color={colors.text}>RETRIEVE      <Text color={colors.warning}>/query</Text>        Fetch relevant memories</Text>
          <Text color={colors.text}>CONNECT       <Text color={colors.warning}>/connectors</Text>   Connect ByteRover to your agent</Text>
          <Text color={colors.text}>-------------------------------------------------------------</Text>
          <Text color={colors.text}> </Text>
          <Text color={colors.text}>GET STARTED:</Text>
          <Text color={colors.text}>Your memory hub is currently empty. Create your first memory:</Text>
          <Text color={colors.text}><Text color={colors.warning}>/curate</Text> <Text color={colors.primary}>Curate the folder structure of this repository</Text></Text>
        </Box>
      </Box>
    </Box>
  )
}
