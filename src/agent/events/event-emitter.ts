import {EventEmitter} from 'node:events'

import type {AgentEventMap, SessionEventMap} from '../types/agent-events/types.js'
import type {EventListenerOptions, IEventEmitter} from '../interfaces/i-event-emitter.js'

/**
 * Base implementation of a type-safe event emitter.
 *
 * Extends Node.js EventEmitter with TypeScript type safety and AbortController support.
 * This follows the pattern from Dexto's event system.
 *
 * Features:
 * - Type-safe emit/on/once/off methods
 * - AbortController integration for automatic listener cleanup
 * - Proper handling of void payloads
 * - WeakMap-based tracking for signal-listener associations
 *
 * @template TEventMap - Map of event names to their payload types
 *
 * @example
 * ```typescript
 * interface MyEvents {
 *   'data:received': { value: number };
 *   'data:cleared': void;
 * }
 *
 * class MyEventBus extends BaseTypedEventEmitter<MyEvents> {}
 *
 * const bus = new MyEventBus();
 * bus.emit('data:received', { value: 42 });
 * bus.emit('data:cleared');
 *
 * // With AbortController
 * const controller = new AbortController();
 * bus.on('data:received', (data) => console.log(data.value), { signal: controller.signal });
 * controller.abort(); // Automatically removes listener
 * ```
 */
export class BaseTypedEventEmitter<TEventMap extends object>
  // eslint-disable-next-line unicorn/prefer-event-target
  extends EventEmitter
  implements IEventEmitter<TEventMap>
{
  /**
   * WeakMap tracking AbortSignal → Set<listener function>.
   * Used to automatically remove listeners when signals are aborted.
   */
  private readonly signalListeners = new WeakMap<AbortSignal, Set<(data?: unknown) => void>>()

  /**
   * Emit an event with optional payload.
   *
   * @param eventName - Name of the event to emit
   * @param payload - Event payload (omit for void events)
   * @returns true if the event had listeners, false otherwise
   */
  public override emit<K extends keyof TEventMap>(
    eventName: K,
    ...payload: TEventMap[K] extends void ? [] : [TEventMap[K]]
  ): boolean
  public override emit(eventName: string, ...args: never[]): boolean
  public override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    return super.emit(eventName, ...args)
  }

  /**
   * Remove an event listener.
   *
   * @param eventName - Name of the event
   * @param listener - Callback function to remove
   * @returns this (for chaining)
   */
  public override off<K extends keyof TEventMap>(
    eventName: K,
    listener: TEventMap[K] extends void ? () => void : (payload: TEventMap[K]) => void,
  ): this
  public override off(eventName: string | symbol, listener: (data?: unknown) => void): this
  public override off(eventName: string | symbol, listener: (data?: unknown) => void): this {
    return super.off(eventName, listener)
  }

  /**
   * Register an event listener.
   *
   * @param eventName - Name of the event to listen for
   * @param listener - Callback function
   * @param options - Optional AbortSignal for automatic cleanup
   * @returns this (for chaining)
   */
  public override on<K extends keyof TEventMap>(
    eventName: K,
    listener: TEventMap[K] extends void ? () => void : (payload: TEventMap[K]) => void,
    options?: EventListenerOptions,
  ): this
  public override on(eventName: string | symbol, listener: (data?: unknown) => void): this
  public override on(eventName: string | symbol, listener: (data?: unknown) => void, options?: EventListenerOptions): this {
    // If signal is already aborted, don't add the listener
    if (options?.signal?.aborted) {
      return this
    }

    // Add the listener
    super.on(eventName, listener)

    // Handle AbortController cleanup
    if (options?.signal) {
      this.setupAbortCleanup(eventName, listener, options.signal)
    }

    return this
  }

  /**
   * Register a one-time event listener.
   *
   * @param eventName - Name of the event to listen for
   * @param listener - Callback function
   * @param options - Optional AbortSignal for automatic cleanup
   * @returns this (for chaining)
   */
  public override once<K extends keyof TEventMap>(
    eventName: K,
    listener: TEventMap[K] extends void ? () => void : (payload: TEventMap[K]) => void,
    options?: EventListenerOptions,
  ): this
  public override once(eventName: string | symbol, listener: (data?: unknown) => void): this
  public override once(eventName: string | symbol, listener: (data?: unknown) => void, options?: EventListenerOptions): this {
    // If signal is already aborted, don't add the listener
    if (options?.signal?.aborted) {
      return this
    }

    // Add the listener
    super.once(eventName, listener)

    // Handle AbortController cleanup
    if (options?.signal) {
      this.setupAbortCleanup(eventName, listener, options.signal)
    }

    return this
  }

  /**
   * Setup automatic cleanup when AbortSignal fires.
   *
   * @param eventName - Event name
   * @param listener - Listener function to remove
   * @param signal - AbortSignal to watch
   */
  private setupAbortCleanup(
    eventName: string | symbol,
    listener: (data?: unknown) => void,
    signal: AbortSignal,
  ): void {
    // If already aborted, remove listener immediately
    if (signal.aborted) {
      super.off(eventName, listener)
      return
    }

    // Track this listener for this signal
    let listeners = this.signalListeners.get(signal)
    if (!listeners) {
      listeners = new Set()
      this.signalListeners.set(signal, listeners)
    }

    listeners.add(listener)

    // Setup abort handler
    const abortHandler = () => {
      super.off(eventName, listener)

      // Cleanup tracking
      const trackedListeners = this.signalListeners.get(signal)
      if (trackedListeners) {
        trackedListeners.delete(listener)
        if (trackedListeners.size === 0) {
          // No more listeners for this signal
          signal.removeEventListener('abort', abortHandler)
        }
      }
    }

    signal.addEventListener('abort', abortHandler, {once: true})
  }
}

/**
 * Event bus for agent-level events.
 *
 * Handles global agent events like state changes, conversation resets, etc.
 * All events include sessionId to track which session triggered the event.
 *
 * @example
 * ```typescript
 * const agentBus = new AgentEventBus();
 *
 * agentBus.on('cipher:stateChanged', (payload) => {
 *   console.log(`State changed: ${payload.field} in session ${payload.sessionId}`);
 * });
 *
 * agentBus.emit('cipher:stateChanged', {
 *   field: 'model',
 *   newValue: 'gemini-2.5-flash',
 *   sessionId: 'session-123'
 * });
 * ```
 */
export class AgentEventBus extends BaseTypedEventEmitter<AgentEventMap> {}

/**
 * Event bus for session-level events.
 *
 * Handles session-scoped events like LLM thinking, tool calls, responses, etc.
 * Events do not include sessionId as they are already scoped to a specific session.
 *
 * Typically, these events are forwarded to the AgentEventBus with sessionId added.
 *
 * @example
 * ```typescript
 * const sessionBus = new SessionEventBus();
 *
 * sessionBus.on('llmservice:toolCall', (payload) => {
 *   console.log(`Tool call: ${payload.toolName}`);
 * });
 *
 * sessionBus.emit('llmservice:toolCall', {
 *   toolName: 'read_file',
 *   args: { filePath: '/path/to/file' },
 *   callId: 'call-456'
 * });
 * ```
 */
export class SessionEventBus extends BaseTypedEventEmitter<SessionEventMap> {}
