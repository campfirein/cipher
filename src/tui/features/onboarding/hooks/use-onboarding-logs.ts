/**
 * Onboarding Logs Hook
 *
 * Returns activity logs during the onboarding flow.
 * Only updates while in onboarding mode - freezes logs when it ends.
 */

import {useEffect, useState} from 'react'

import type {ActivityLog} from '../../../types/index.js'

import {useActivityLogs} from '../../activity/hooks/use-activity-logs.js'
import {useOnboarding} from './use-onboarding.js'

export interface UseOnboardingLogsReturn {
  /** Onboarding logs derived from activity logs */
  logs: ActivityLog[]
}

/**
 * Hook that returns activity logs during the onboarding flow.
 * Only updates logs while in onboarding mode.
 * When onboarding ends, logs are frozen (no more updates).
 */
export function useOnboardingLogs(): UseOnboardingLogsReturn {
  const {logs: activityLogs} = useActivityLogs()
  const {viewMode} = useOnboarding()
  const [logs, setLogs] = useState<ActivityLog[]>([])

  const isOnboarding = viewMode.type === 'onboarding'

  useEffect(() => {
    if (!isOnboarding) {
      return
    }

    setLogs(activityLogs)
  }, [activityLogs, isOnboarding])

  return {logs}
}
