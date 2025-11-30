import {z} from 'zod'

import type {Todo, WriteTodosResult} from '../../../../core/domain/cipher/todos/types.js'
import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'

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
const TOOL_DESCRIPTION = `Use this tool to create and manage a structured task list for the current session. This helps track progress, organize complex tasks, and demonstrate thoroughness to the user.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. **Complex multi-step tasks** - When a task requires 3 or more distinct steps
2. **Non-trivial and complex tasks** - Tasks that require careful planning or multiple operations
3. **User explicitly requests todo list** - When the user directly asks to use the todo list
4. **User provides multiple tasks** - When users provide a list of things to be done
5. **After receiving new instructions** - Immediately capture user requirements as todos
6. **When you start working on a task** - Mark it as in_progress BEFORE beginning work
7. **After completing a task** - Mark it as completed and add any follow-up tasks

## When NOT to Use This Tool
Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

## Task States
- **pending**: Task not yet started
- **in_progress**: Currently working on (limit to ONE task at a time)
- **completed**: Task finished successfully
- **cancelled**: Task no longer needed

## Important Rules
- ONLY ONE task can be "in_progress" at any time
- Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
- Task descriptions need both forms:
  - content: Imperative form (e.g., "Run tests")
  - activeForm: Present continuous form (e.g., "Running tests")`

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
 *
 * @param todos - Array of todos
 * @returns Formatted string representation
 */
function formatTodosForLLM(todos: Todo[]): string {
  const lines = ['Todo list updated:']

  for (const todo of todos) {
    const statusIcon = getStatusIcon(todo.status)
    lines.push(`${statusIcon} [${todo.status}] ${todo.content}`)
  }

  const stats = getTodoStats(todos)
  const progressLines = [
    '',
    `Progress: ${stats.completed}/${stats.total} completed`,
  ]

  if (stats.inProgress > 0) {
    const currentTask = todos.find((t) => t.status === 'in_progress')
    if (currentTask) {
      progressLines.push(`Currently: ${currentTask.activeForm}`)
    }
  }

  return [...lines, ...progressLines].join('\n')
}

/**
 * Gets icon for todo status.
 *
 * @param status - Todo status
 * @returns Status icon
 */
function getStatusIcon(status: Todo['status']): string {
  switch (status) {
    case 'cancelled': {
      return '⊘'
    }

    case 'completed': {
      return '✓'
    }

    case 'in_progress': {
      return '→'
    }

    case 'pending': {
      return '○'
    }
  }
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
 *
 * @returns Configured write todos tool
 */
export function createWriteTodosTool(): Tool {
  return {
    description: TOOL_DESCRIPTION,
    async execute(input: unknown, _context?: ToolExecutionContext): Promise<string | WriteTodosResult> {
      const {todos} = input as WriteTodosInput

      // Validate only one in_progress
      const validationError = validateSingleInProgress(todos)
      if (validationError) {
        return validationError
      }

      // Format response for LLM
      const llmContent = formatTodosForLLM(todos)

      // Return both LLM content and display content
      return {
        llmContent,
        returnDisplay: {todos},
      }
    },
    id: ToolName.WRITE_TODOS,
    inputSchema: WriteTodosInputSchema,
  }
}
