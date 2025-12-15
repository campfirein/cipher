/**
 * TUI App - Main Layout
 *
 * Two main states:
 * - Unauthorized: Show login prompt
 * - Authorized: Show main app with tabs
 */

import {Box, useStdout} from 'ink'
import React from 'react'

import {Footer, Header, TabBar} from './components/index.js'
import {LAYOUT} from './constants.js'
import {useAuth, useConsumer} from './contexts/index.js'
import {useTabNavigation} from './hooks/index.js'
import {CommandView, LoginView, LogsView} from './views/index.js'

export const App: React.FC = () => {
  const {stdout} = useStdout()
  const terminalHeight = stdout?.rows ?? 24
  const terminalWidth = stdout?.columns ?? 80

  // Get auth state from context
  const {isAuthorized} = useAuth()

  // Tab navigation and queue hooks
  const {activeTab} = useTabNavigation()
  const {stats} = useConsumer()

  const contentHeight = Math.max(1, terminalHeight - LAYOUT.headerHeight - LAYOUT.tabBarHeight - LAYOUT.footerHeight)

  return (
    <Box flexDirection="column" height={terminalHeight} paddingBottom={1} width={terminalWidth}>
      {/* Header - always shown, but no queueStats when unauthorized */}
      <Box flexShrink={0}>
        <Header
          compact={isAuthorized}
          queueStats={stats ? {pending: stats.queued, processing: stats.running} : undefined}
          showQueueStats={isAuthorized}
        />
      </Box>

      {isAuthorized ? (
        <>
          <Box flexShrink={0}>
            <TabBar activeTab={activeTab} />
          </Box>

          <Box flexGrow={1} height={contentHeight} paddingX={1}>
            <Box display={activeTab === 'activity' ? 'flex' : 'none'} height="100%" width="100%">
              <LogsView availableHeight={contentHeight} />
            </Box>
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
