import {useCallback, useState} from 'react'

export function useContextLayout() {
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true)
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false)

  const toggleLeftPanel = useCallback(() => {
    setIsLeftPanelOpen((prev) => !prev)
  }, [])

  const toggleRightPanel = useCallback(() => {
    setIsRightPanelOpen((prev) => !prev)
  }, [])

  const closeRightPanel = useCallback(() => {
    setIsRightPanelOpen(false)
  }, [])

  return {
    closeRightPanel,
    isLeftPanelOpen,
    isRightPanelOpen,
    toggleLeftPanel,
    toggleRightPanel,
  }
}
