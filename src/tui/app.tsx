/**
 * TUI App - Main Layout
 *
 * Two main states:
 * - Unauthorized: Show login prompt
 * - Authorized: Show main app with tabs
 */

import {Box} from 'ink'
import React, {useEffect, useState} from 'react'

import {Footer, Header, TabBar} from './components/index.js'
import {useAuth, useServices, useTasks} from './contexts/index.js'
import {useTabNavigation, useTerminalBreakpoint, useUIHeights} from './hooks/index.js'
import {CommandView, LoginView, LogsView} from './views/index.js'

export const App: React.FC = () => {
  const {columns: terminalWidth, rows: terminalHeight} = useTerminalBreakpoint()
  const {appBottomPadding, footer, header, tab} = useUIHeights()
  const {connectorManager} = useServices()

  const {isAuthorized} = useAuth()
  const {activeTab, tabs} = useTabNavigation()
  const {stats: taskStats} = useTasks()

  const [selectedLogIndex, setSelectedLogIndex] = useState(0)
  const [expandedViewLogId, setExpandedViewLogId] = useState<null | string>(null)

  const contentHeight = Math.max(1, terminalHeight - header - tab - footer)

  useEffect(() => {
    // Clean up orphaned connectors from agents that no longer support them.
    // Runs in the background to avoid blocking REPL startup.
    connectorManager.migrateOrphanedConnectors().catch(console.error)
  }, [])

  return (
    <Box flexDirection="column" height={terminalHeight} paddingBottom={appBottomPadding} width={terminalWidth}>
      {/* Header - always shown, but no taskStats when unauthorized */}
      <Box flexShrink={0}>
        <Header compact={isAuthorized} showStatusLine={isAuthorized} taskStats={taskStats} />
      </Box>

      {isAuthorized ? (
        <>
          <Box flexShrink={0}>
            <TabBar activeTab={activeTab} tabs={tabs} />
          </Box>

          <Box flexGrow={1} paddingX={1}>
            {activeTab === 'activity' && (
              <LogsView
                availableHeight={contentHeight}
                expandedViewLogId={expandedViewLogId}
                selectedLogIndex={selectedLogIndex}
                setExpandedViewLogId={setExpandedViewLogId}
                setSelectedLogIndex={setSelectedLogIndex}
              />
            )}
            <Box display={activeTab === 'console' ? 'flex' : 'none'} height="100%" width="100%">
              <CommandView availableHeight={contentHeight} />
            </Box>
          </Box>

          <Box flexShrink={0}>
            <Footer />
          </Box>
        </>
      ) : (
        <Box flexGrow={1} paddingX={1}>
          <LoginView />
        </Box>
      )}
    </Box>
  )
}
