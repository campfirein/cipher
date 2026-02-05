/**
 * Onboarding Logs Hook
 *
 * Returns activity logs during the onboarding flow.
 * Only updates while shouldShowOnboarding is true - freezes logs when it becomes false.
 */

import {useEffect, useState} from 'react'

import type {ActivityLog} from '../types.js'

import {useOnboarding} from '../contexts/onboarding-context.js'
import {useActivityLogs} from './use-activity-logs.js'

export interface UseOnboardingLogsReturn {
  /** Onboarding logs derived from activity logs */
  logs: ActivityLog[]
}

/**
 * Hook that returns activity logs during the onboarding flow.
 * Only updates logs while shouldShowOnboarding is true.
 * When shouldShowOnboarding becomes false, logs are frozen (no more updates).
 */
export function useOnboardingLogs(): UseOnboardingLogsReturn {
  const {logs: activityLogs} = useActivityLogs()
  const {shouldShowOnboarding} = useOnboarding()
  const [logs, setLogs] = useState<ActivityLog[]>([])

  useEffect(() => {
    if (!shouldShowOnboarding) {
      return
    }

    setLogs(activityLogs)
  }, [activityLogs, shouldShowOnboarding])

  return {logs}
}
