/**
 * Tab Navigation Hook
 */

import {useApp, useInput} from 'ink'
import {useEffect, useMemo, useState} from 'react'

import type {Tab, TabId} from '../types.js'

import {DEFAULT_TAB, TABS} from '../constants.js'
import {useMode} from '../contexts/mode-context.js'
import {useOnboarding} from './use-onboarding.js'

interface UseTabNavigationResult {
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
  tabs: Tab[]
}

export function useTabNavigation(): UseTabNavigationResult {
  const {exit} = useApp()
  const {shouldShowOnboarding} = useOnboarding()
  const {mode, setMode} = useMode()
  const [activeTab, setActiveTab] = useState<TabId>(DEFAULT_TAB)

  // Filter tabs based on onboarding state - hide console during onboarding
  const tabs = useMemo<Tab[]>(
    () => (shouldShowOnboarding ? TABS.filter((t) => t.id !== 'console') : TABS),
    [shouldShowOnboarding],
  )

  // Sync mode with active tab on mount and when activeTab changes
  useEffect(() => {
    setMode(activeTab === 'activity' ? 'activity' : 'console')
  }, [activeTab, setMode])

  // Reset to activity tab if current tab is not available
  useEffect(() => {
    const isCurrentTabAvailable = tabs.some((t) => t.id === activeTab)
    if (!isCurrentTabAvailable) {
      setActiveTab(DEFAULT_TAB)
    }
  }, [tabs, activeTab])

  useInput(
    (input, key) => {
      // Tab: cycle through available tabs (blocked during onboarding)
      if (key.tab && !shouldShowOnboarding) {
        const currentIndex = tabs.findIndex((t) => t.id === activeTab)
        const nextIndex = currentIndex >= tabs.length - 1 ? 0 : currentIndex + 1
        const nextTab = tabs[nextIndex].id
        setActiveTab(nextTab)
        // Mode will be synced by useEffect
      }

      // Quit with Ctrl+C
      if (key.ctrl && input === 'c') {
        exit()
      }
    },
    {isActive: mode === 'activity' || mode === 'console'},
  )

  return {activeTab, setActiveTab, tabs}
}
