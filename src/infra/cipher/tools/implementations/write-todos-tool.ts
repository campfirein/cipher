import {z} from 'zod'

import type {Todo, WriteTodosResult} from '../../../../core/domain/cipher/todos/types.js'
import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'
import type {ITodoStorage} from '../../../../core/interfaces/cipher/i-todo-storage.js'

import {TODO_STATUSES} from '../../../../core/domain/cipher/todos/types.js'
import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'

/**
 * Schema for a single todo item.
 */
const TodoSchema = z.object({
  activeForm: z
    .string()
    .min(1)
    .describe('Present continuous form shown during execution (e.g., "Running tests")'),
  content: z.string().min(1).describe('Imperative description of the task (e.g., "Run tests")'),
  id: z.string().min(1).describe('Unique identifier for the todo item'),
  status: z
    .enum(TODO_STATUSES)
    .describe('Task status: pending, in_progress (only ONE at a time), completed, or cancelled'),
})

/**
 * Input schema for write todos tool.
 */
const WriteTodosInputSchema = z
  .object({
    todos: z.array(TodoSchema).min(1).describe('List of todo items to track'),
  })
  .strict()

/**
 * Input type derived from schema.
 */
type WriteTodosInput = z.infer<typeof WriteTodosInputSchema>

/**
 * Tool description with detailed usage guidance.
 * This helps the LLM understand when to use the tool and how.
 */
const TOOL_DESCRIPTION = `Use this tool to create and manage a structured task list for the current session.`

/**
 * Validates that only one todo is in_progress.
 *
 * @param todos - Array of todos to validate
 * @returns Error message if invalid, null if valid
 */
function validateSingleInProgress(todos: Todo[]): null | string {
  const inProgressCount = todos.filter((todo) => todo.status === 'in_progress').length
  if (inProgressCount > 1) {
    return `Invalid parameters: Only one task can be "in_progress" at a time. Found ${inProgressCount} tasks in progress.`
  }

  return null
}

/**
 * Formats the todo list for LLM response.
 * Uses opencode-style status icons: [✓] for completed, [ ] for others.
 *
 * @param todos - Array of todos
 * @returns Formatted string representation
 */
function formatTodosForLLM(todos: Todo[]): string {
  const lines = ['Todo list updated:']

  for (const todo of todos) {
    const checkbox = todo.status === 'completed' ? '[✓]' : '[ ]'
    const statusLabel = todo.status === 'in_progress' ? ' (in_progress)' : ''
    lines.push(`${checkbox} ${todo.content}${statusLabel}`)
  }

  const stats = getTodoStats(todos)
  const progressLines = ['', `Progress: ${stats.completed}/${stats.total} completed`]

  if (stats.inProgress > 0) {
    const currentTask = todos.find((t) => t.status === 'in_progress')
    if (currentTask) {
      progressLines.push(`Currently: ${currentTask.activeForm}`)
    }
  }

  return [...lines, ...progressLines].join('\n')
}

/**
 * Gets statistics about the todo list.
 *
 * @param todos - Array of todos
 * @returns Statistics object
 */
function getTodoStats(todos: Todo[]): {
  cancelled: number
  completed: number
  inProgress: number
  pending: number
  total: number
} {
  return {
    cancelled: todos.filter((t) => t.status === 'cancelled').length,
    completed: todos.filter((t) => t.status === 'completed').length,
    inProgress: todos.filter((t) => t.status === 'in_progress').length,
    pending: todos.filter((t) => t.status === 'pending').length,
    total: todos.length,
  }
}

/**
 * Creates the write todos tool.
 *
 * Manages a structured task list for planning-based execution.
 * Validates that only one task is in_progress at any time.
 * Stores todos in session-based storage.
 *
 * @param todoStorage - Storage service for persisting todos
 * @returns Configured write todos tool
 */
export function createWriteTodosTool(todoStorage: ITodoStorage): Tool {
  return {
    description: TOOL_DESCRIPTION,
    async execute(input: unknown, context?: ToolExecutionContext): Promise<string | WriteTodosResult> {
      const {todos} = input as WriteTodosInput

      // Validate only one in_progress
      const validationError = validateSingleInProgress(todos)
      if (validationError) {
        return validationError
      }

      // Store todos in session storage
      const sessionId = context?.sessionId ?? 'default'
      await todoStorage.update(sessionId, todos)

      // Format response for LLM
      const llmContent = formatTodosForLLM(todos)

      // Calculate incomplete count for smart title
      const incompleteCount = todos.filter((t) => t.status !== 'completed').length

      // Return both LLM content and display content with metadata
      return {
        llmContent,
        metadata: {todos},
        returnDisplay: {todos},
        title: `${incompleteCount} todos`,
      }
    },
    id: ToolName.WRITE_TODOS,
    inputSchema: WriteTodosInputSchema,
  }
}
