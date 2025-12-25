import type {Todo} from '../../domain/cipher/todos/types.js'

/**
 * Interface for session-based todo storage.
 *
 * Implementations can use different storage backends (in-memory, persistent, etc.)
 * to store and retrieve todo lists per session.
 */
export interface ITodoStorage {
  /**
   * Get todos for a specific session.
   *
   * @param sessionId - Unique session identifier
   * @returns Promise that resolves to array of todos, empty array if not found
   */
  get(sessionId: string): Promise<Todo[]>

  /**
   * Update (replace) todos for a specific session.
   *
   * @param sessionId - Unique session identifier
   * @param todos - Array of todos to store
   * @returns Promise that resolves when todos are saved
   */
  update(sessionId: string, todos: Todo[]): Promise<void>
}
