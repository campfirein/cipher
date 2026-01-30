import {EventName, PropertyDict} from '../../domain/entities/event.js'

/**
 * Service interface for tracking user actions and system events.
 *
 * Provides a unified contract for event tracking and analytics throughout the application.
 * Implementations should be non-blocking and handle failures gracefully to avoid impacting
 * user operations.
 */
export interface ITrackingService {
  /**
   * Tracks a named event with optional metadata.
   *
   * This method should be asynchronous and non-blocking. Implementations should log
   * errors internally rather than throwing, to prevent tracking failures from disrupting
   * user operations.
   *
   * @param eventName - The name of the event to track. Must be one of the predefined EventName values.
   * @param properties - Optional metadata to attach to the event as key-value pairs. All values must be strings.
   */
  track(eventName: EventName, properties?: PropertyDict): Promise<void>
}
