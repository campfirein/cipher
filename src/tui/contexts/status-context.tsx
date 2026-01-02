/**
 * Status Context
 *
 * Manages status events for display in the Header's StatusBadge.
 * Subscribes to task completion/failure events and auto-dismisses after timeout.
 */

import React, {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react'

import {useOnboarding} from '../hooks/use-onboarding.js'
import {STATUS_DISMISS_TIMES, StatusEvent} from '../types/status.js'
import {TaskStatus, useTasks} from './tasks-context.js'

/**
 * Context value for status events.
 */
export interface StatusContextValue {
  /**
   * Current active status event (or null if none)
   */
  currentEvent: null | StatusEvent
  /**
   * Push a new status event
   */
  pushEvent: (event: Omit<StatusEvent, 'id' | 'timestamp'>) => void
}

const StatusContext = createContext<StatusContextValue | undefined>(undefined)

/**
 * Generate a unique ID for status events
 */
function generateId(): string {
  return `status-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Provider component that manages status events with auto-dismiss.
 * Subscribes to TasksContext for task completion/error events.
 */
export function StatusProvider({children}: {children: React.ReactNode}): React.ReactElement {
  const {tasks} = useTasks()
  const {isInitialized} = useOnboarding()
  const [currentEvent, setCurrentEvent] = useState<null | StatusEvent>(null)
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null)
  // Track last known status per task to detect state changes
  const taskStatusRef = useRef<Map<string, TaskStatus>>(new Map())

  // Clear dismiss timer
  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  // Push a new status event
  const pushEvent = useCallback(
    (event: Omit<StatusEvent, 'id' | 'timestamp'>) => {
      clearDismissTimer()

      const newEvent: StatusEvent = {
        ...event,
        id: generateId(),
        timestamp: Date.now(),
      }

      setCurrentEvent(newEvent)

      // Set auto-dismiss timer
      dismissTimerRef.current = setTimeout(() => {
        setCurrentEvent((current) => {
          // Only dismiss if it's still the same event
          if (current?.id === newEvent.id) {
            return null
          }

          return current
        })
      }, newEvent.dismissAfter)
    },
    [clearDismissTimer],
  )

  // Monitor initialization status
  useEffect(() => {
    if (!currentEvent && !isInitialized) {
      // No current event and project not initialized - show persistent status
      clearDismissTimer()
      setCurrentEvent({
        dismissAfter: 0,
        id: generateId(),
        label: 'Init',
        message: 'Not configured',
        timestamp: Date.now(),
        type: 'warning',
      })
    } else if (currentEvent?.label === 'Init' && isInitialized) {
      // Project is initialized but init status is showing - clear it
      setCurrentEvent(null)
    }
  }, [isInitialized, currentEvent, clearDismissTimer])

  // Subscribe to task state changes
  useEffect(() => {
    for (const task of tasks.values()) {
      const lastStatus = taskStatusRef.current.get(task.taskId)

      // Skip if status hasn't changed
      if (lastStatus === task.status) {
        continue
      }

      // Update tracked status
      taskStatusRef.current.set(task.taskId, task.status)

      const label = task.type.charAt(0).toUpperCase() + task.type.slice(1)

      switch (task.status) {
        case 'completed': {
          const message = task.type === 'curate' ? 'Context saved successfully' : 'Results retrieved'
          pushEvent({
            dismissAfter: STATUS_DISMISS_TIMES.success,
            label,
            message,
            type: 'success',
          })
          break
        }

        case 'created': {
          // Only curate tasks go to queue
          if (task.type === 'curate') {
            pushEvent({
              dismissAfter: STATUS_DISMISS_TIMES.info,
              label,
              message: `Queued: "${task.content}"`,
              type: 'info',
            })
          }

          break
        }

        case 'error': {
          const errorMessage = task.error?.message ?? 'Failed'
          pushEvent({
            dismissAfter: STATUS_DISMISS_TIMES.error,
            label,
            message: `Failed: ${errorMessage}`,
            type: 'error',
          })
          break
        }

        case 'started': {
          // Don't auto-dismiss - stays until complete/error
          clearDismissTimer()
          setCurrentEvent({
            dismissAfter: 0,
            id: generateId(),
            label,
            message: `Processing: "${task.content}"`,
            timestamp: Date.now(),
            type: 'warning',
          })
          break
        }

        default: {
          break
        }
      }
    }
  }, [tasks, pushEvent])

  // Cleanup timer on unmount
  useEffect(
    () => () => {
      clearDismissTimer()
    },
    [clearDismissTimer],
  )

  const value: StatusContextValue = {
    currentEvent,
    pushEvent,
  }

  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>
}

/**
 * Hook to access status context.
 * Must be used within a StatusProvider.
 */
export function useStatus(): StatusContextValue {
  const context = useContext(StatusContext)
  if (!context) {
    throw new Error('useStatus must be used within a StatusProvider')
  }

  return context
}
