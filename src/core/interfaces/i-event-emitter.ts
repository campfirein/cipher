/**
 * Options for event listener registration.
 */
export interface EventListenerOptions {
  /**
   * AbortSignal for automatic listener cleanup.
   * When the signal is aborted, the listener will be automatically removed.
   */
  signal?: AbortSignal
}

/**
 * Type-safe event emitter interface.
 *
 * @template TEventMap - Map of event names to their payload types
 *
 * @example
 * ```typescript
 * interface MyEvents {
 *   'user:login': { userId: string };
 *   'user:logout': void;
 * }
 *
 * const emitter: IEventEmitter<MyEvents> = ...;
 *
 * // Type-safe emission
 * emitter.emit('user:login', { userId: '123' });
 * emitter.emit('user:logout'); // No payload needed for void events
 *
 * // Type-safe listening
 * emitter.on('user:login', (payload) => {
 *   console.log(payload.userId); // TypeScript knows payload type
 * });
 *
 * // AbortController cleanup
 * const controller = new AbortController();
 * emitter.on('user:login', handler, { signal: controller.signal });
 * controller.abort(); // Automatically removes listener
 * ```
 */
export interface IEventEmitter<TEventMap extends object> {
  /**
   * Emit an event with a payload.
   *
   * @param eventName - Name of the event to emit
   * @param payload - Event payload (type-checked against TEventMap)
   * @returns true if the event had listeners, false otherwise
   */
  emit<K extends keyof TEventMap>(
    eventName: K,
    ...payload: TEventMap[K] extends void ? [] : [TEventMap[K]]
  ): boolean

  /**
   * Remove an event listener.
   *
   * @param eventName - Name of the event
   * @param listener - Callback function to remove
   * @returns this (for chaining)
   */
  off<K extends keyof TEventMap>(
    eventName: K,
    listener: TEventMap[K] extends void ? () => void : (payload: TEventMap[K]) => void,
  ): this

  /**
   * Register an event listener.
   *
   * @param eventName - Name of the event to listen for
   * @param listener - Callback function (receives typed payload)
   * @param options - Listener options (e.g., AbortSignal for cleanup)
   * @returns this (for chaining)
   */
  on<K extends keyof TEventMap>(
    eventName: K,
    listener: TEventMap[K] extends void ? () => void : (payload: TEventMap[K]) => void,
    options?: EventListenerOptions,
  ): this

  /**
   * Register a one-time event listener.
   * The listener will be automatically removed after the first invocation.
   *
   * @param eventName - Name of the event to listen for
   * @param listener - Callback function (receives typed payload)
   * @param options - Listener options (e.g., AbortSignal for cleanup)
   * @returns this (for chaining)
   */
  once<K extends keyof TEventMap>(
    eventName: K,
    listener: TEventMap[K] extends void ? () => void : (payload: TEventMap[K]) => void,
    options?: EventListenerOptions,
  ): this
}
