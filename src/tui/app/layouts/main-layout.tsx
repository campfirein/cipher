/**
 * MainLayout Component
 *
 * Shared layout for authenticated pages with header, content area, and footer.
 */

import {Box} from 'ink'
import React from 'react'

import {CommandInput, Footer, Header} from '../../components/index.js'
import {useAppViewMode} from '../../features/onboarding/hooks/use-app-view-mode.js'
import {useTerminalBreakpoint, useUIHeights} from '../../hooks/index.js'

interface MainLayoutProps {
  /** Content to render in the main area */
  children: React.ReactNode
  /** Whether to show the command input */
  showInput?: boolean
}

export function MainLayout({children, showInput = false}: MainLayoutProps): React.ReactNode {
  const {rows: terminalHeight} = useTerminalBreakpoint()
  const {appBottomPadding, footer, header} = useUIHeights()
  const viewMode = useAppViewMode()

  const contentHeight = Math.max(1, terminalHeight - header - footer)
  const inputHeight = showInput ? 3 : 0
  const mainHeight = Math.max(1, contentHeight - inputHeight)

  return (
    <Box flexDirection="column" height={terminalHeight} paddingBottom={appBottomPadding}>
      <Box flexShrink={0}>
        <Header compact={viewMode.type !== 'config-provider'} />
      </Box>

      <Box flexDirection="column" height={contentHeight} paddingX={1} width="100%">
        <Box flexDirection="column" height={mainHeight}>
          {children}
        </Box>
        {showInput && <CommandInput />}
      </Box>

      <Box flexShrink={0}>
        <Footer />
      </Box>
    </Box>
  )
}
