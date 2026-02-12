/**
 * InitPage
 *
 * Project initialization page for existing users who need to set up a new project.
 */

import React from 'react'

import {InitView} from '../../features/init/components/index.js'
import {useTerminalBreakpoint, useUIHeights} from '../../hooks/index.js'
import {MainLayout} from '../layouts/main-layout.js'

export function InitPage(): React.ReactNode {
  const {rows: terminalHeight} = useTerminalBreakpoint()
  const {footer, header} = useUIHeights()

  const contentHeight = Math.max(1, terminalHeight - header - footer)

  return (
    <MainLayout showInput={false}>
      <InitView availableHeight={contentHeight} />
    </MainLayout>
  )
}
