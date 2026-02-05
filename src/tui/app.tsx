/**
 * TUI App - Main Layout
 *
 * Two main states:
 * - Unauthorized: Show login prompt
 * - Authorized: Show main app with tabs
 */

import {Box} from 'ink'
import React from 'react'

import {Footer, Header} from './components/index.js'
import {useAuth} from './contexts/index.js'
import {useTerminalBreakpoint, useUIHeights} from './hooks/index.js'
import {LoginView} from './views/index.js'
import {MainView} from './views/main-view.js'

export const App: React.FC = () => {
  const {columns: terminalWidth, rows: terminalHeight} = useTerminalBreakpoint()
  const {appBottomPadding, footer, header} = useUIHeights()
  const {isAuthorized} = useAuth()

  const contentHeight = Math.max(1, terminalHeight - header - footer)

  return (
    <Box flexDirection="column" height={terminalHeight} paddingBottom={appBottomPadding} width={terminalWidth}>
      {/* Header - always shown, but no taskStats when unauthorized */}
      <Box flexShrink={0}>
        <Header compact={isAuthorized} />
      </Box>

      {isAuthorized ? (
        <>
          <MainView availableHeight={contentHeight} />
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
