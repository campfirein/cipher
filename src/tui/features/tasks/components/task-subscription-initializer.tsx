/**
 * Invisible component that subscribes the tasks Zustand store to transport events.
 * Place this inside the TransportProvider tree.
 */

import {useTaskSubscriptions} from '../hooks/use-task-subscriptions.js'

export function TaskSubscriptionInitializer(): null {
  useTaskSubscriptions()
  return null
}
