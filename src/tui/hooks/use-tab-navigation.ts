/**
 * Tab Navigation Hook
 */

import {useApp, useInput} from 'ink'
import {useEffect, useState} from 'react'

import type {TabId} from '../types.js'

import {stopQueuePollingService} from '../../infra/cipher/consumer/queue-polling-service.js'
import {DEFAULT_TAB, TABS} from '../constants.js'
import {useMode} from '../contexts/mode-context.js'
import {useOnboarding} from './use-onboarding.js'

interface UseTabNavigationResult {
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
}

export function useTabNavigation(): UseTabNavigationResult {
  const {exit} = useApp()
  const {shouldShowOnboarding} = useOnboarding()
  const {mode, setMode} = useMode()
  const [activeTab, setActiveTab] = useState<TabId>(DEFAULT_TAB)

  // Sync mode with active tab on mount and when activeTab changes
  useEffect(() => {
    setMode(activeTab === 'activity' ? 'activity' : 'console')
  }, [activeTab, setMode])

  useInput(
    (input, key) => {
      // Tab: cycle through tabs (blocked during onboarding)
      if (key.tab && !shouldShowOnboarding) {
        const currentIndex = TABS.findIndex((t) => t.id === activeTab)
        const nextIndex = currentIndex >= TABS.length - 1 ? 0 : currentIndex + 1
        const nextTab = TABS[nextIndex].id
        setActiveTab(nextTab)
        // Mode will be synced by useEffect
      }

      // Quit with Ctrl+C
      if (key.ctrl && input === 'c') {
        stopQueuePollingService()
        exit()
      }
    },
    {isActive: mode === 'activity' || mode === 'console'},
  )

  return {activeTab, setActiveTab}
}
