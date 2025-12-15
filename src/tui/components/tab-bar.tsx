/**
 * Tab Bar Component
 */

import { Box, Text } from 'ink'
import React from 'react'

import type { TabId } from '../types.js'

import { TABS } from '../constants.js'
import { useTheme } from '../contexts/use-theme.js'

interface TabBarProps {
  activeTab: TabId
}

export const TabBar: React.FC<TabBarProps> = ({ activeTab }) => {
  const {
    theme: { colors },
  } = useTheme()

  return (
    <Box alignItems="flex-end" paddingX={1} width="100%">
      <Box
        borderColor={colors.border}
        borderLeft={false}
        borderRight={false}
        borderStyle="single"
        height="100%"
        width={2}
      />

      {TABS.map((tab) => (
        <React.Fragment key={tab.id}>
          <Box
            borderBottomColor={activeTab === tab.id ? colors.primary : colors.border}
            borderColor={colors.border}
            borderLeft={false}
            borderRight={false}
            borderStyle="single"
          >
            <Text>{tab.label}</Text>
          </Box>
          <Box
            borderColor={colors.border}
            borderLeft={false}
            borderRight={false}
            borderStyle="single"
            height="100%"
            width={6}
          />
        </React.Fragment>
      ))}

      <Box
        borderColor={colors.border}
        borderLeft={false}
        borderRight={false}
        borderStyle="single"
        flexGrow={1}
        height="100%"
      />
    </Box>
  )
}
