/**
 * List Component
 *
 * Renders a scrollable list using ink-scroll-list with children
 */

import {useStdout} from 'ink'
import {ScrollList, ScrollListRef} from 'ink-scroll-list'
import React, {ReactNode, useEffect, useRef, useState} from 'react'

interface ListProps {
  /** Children to render in the list */
  children: ReactNode
  /** Available height for the list (in terminal rows) */
  height: number
  /** Currently selected item index */
  selectedIndex: number
}

export const List: React.FC<ListProps> = ({children, height, selectedIndex}) => {
  const scrollListRef = useRef<ScrollListRef>(null)
  const {stdout} = useStdout()
  const [, setResizeKey] = useState(0)

  useEffect(() => {
    const handleResize = () => {
      setResizeKey((prev) => prev + 1)
    }

    stdout?.on('resize', handleResize)

    return () => {
      stdout?.off('resize', handleResize)
    }
  }, [stdout])

  return (
    <ScrollList
      height={height}
      ref={scrollListRef}
      scrollAlignment="auto"
      selectedIndex={selectedIndex}
    >
      {children}
    </ScrollList>
  )
}
