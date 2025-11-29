/**
 * Todo status values.
 * Only ONE task can be "in_progress" at any time.
 */
export const TODO_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const

/**
 * Union type of valid todo statuses.
 */
export type TodoStatus = (typeof TODO_STATUSES)[number]

/**
 * Represents a single todo item.
 */
export interface Todo {
  /**
   * Present continuous form shown during execution.
   * Example: "Running tests", "Building the project"
   */
  activeForm: string

  /**
   * Imperative description of what needs to be done.
   * Example: "Run tests", "Build the project"
   */
  content: string

  /**
   * Current status of the todo.
   * - pending: Not yet started
   * - in_progress: Currently working on (only ONE at a time)
   * - completed: Successfully finished
   * - cancelled: No longer needed
   */
  status: TodoStatus
}

/**
 * List of todos maintained by the agent.
 */
export interface TodoList {
  /**
   * All todo items.
   */
  todos: Todo[]
}

/**
 * Result of write_todos tool execution.
 * Contains both LLM-facing content and display-facing content.
 */
export interface WriteTodosResult {
  /**
   * Content to send back to the LLM.
   */
  llmContent: string

  /**
   * Display content for rendering to user.
   */
  returnDisplay: {
    todos: Todo[]
  }
}
