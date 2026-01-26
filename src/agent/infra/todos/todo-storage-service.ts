import type {Todo} from '../../core/domain/todos/types.js'
import type {ITodoStorage} from '../../core/interfaces/i-todo-storage.js'

/**
 * In-memory implementation of todo storage.
 *
 * Stores todos per session in a Map. Data is lost when process restarts.
 * Use a persistent implementation if you need todos to survive restarts.
 */
export class TodoStorageService implements ITodoStorage {
  private storage = new Map<string, Todo[]>()

  /**
   * Get todos for a specific session.
   *
   * @param sessionId - Unique session identifier
   * @returns Promise that resolves to array of todos, empty array if not found
   */
  async get(sessionId: string): Promise<Todo[]> {
    return this.storage.get(sessionId) ?? []
  }

  /**
   * Update (replace) todos for a specific session.
   *
   * @param sessionId - Unique session identifier
   * @param todos - Array of todos to store
   * @returns Promise that resolves when todos are saved
   */
  async update(sessionId: string, todos: Todo[]): Promise<void> {
    this.storage.set(sessionId, todos)
  }
}
