/**
 * Activity Logs Hook
 *
 * Manages activity log items for the LogsView
 */

import { useCallback, useState } from 'react'

import type { ActivityLog } from '../types.js'

interface UseActivityLogsResult {
  appendLog: (log: Omit<ActivityLog, 'id' | 'timestamp'>) => void
  clearLogs: () => void
  logs: readonly ActivityLog[]
  updateLog: (id: string, updates: Partial<Omit<ActivityLog, 'id' | 'timestamp'>>) => void
}

export function useActivityLogs(initialLogs: ActivityLog[] = []): UseActivityLogsResult {
  const [logs, setLogs] = useState<ActivityLog[]>(initialLogs)

  const appendLog = useCallback((log: Omit<ActivityLog, 'id' | 'timestamp'>) => {
    const newLog: ActivityLog = {
      ...log,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    }
    setLogs((prev) => [...prev, newLog])
  }, [])

  const clearLogs = useCallback(() => {
    setLogs([])
  }, [])

  const updateLog = useCallback((id: string, updates: Partial<Omit<ActivityLog, 'id' | 'timestamp'>>) => {
    setLogs((prev) => prev.map((log) => (log.id === id ? { ...log, ...updates } : log)))
  }, [])

  return {
    appendLog,
    clearLogs,
    logs,
    updateLog,
  }
}
