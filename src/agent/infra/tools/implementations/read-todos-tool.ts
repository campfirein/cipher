import {z} from 'zod'

import type {ReadTodosResult} from '../../../core/domain/todos/types.js'
import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {ITodoStorage} from '../../../core/interfaces/i-todo-storage.js'

import {ToolName} from '../../../core/domain/tools/constants.js'

/**
 * Input schema for read todos tool.
 * No parameters required - reads todos for current session.
 */
const ReadTodosInputSchema = z.object({}).strict()

/**
 * Tool description for read todos.
 */
const TOOL_DESCRIPTION = `Read the current todo list for this session.

Use this tool to check the current state of your task list before making updates.
Returns all todo items with their id, content, activeForm, and status.`

/**
 * Creates the read todos tool.
 *
 * Reads the current todo list from session storage.
 *
 * @param todoStorage - Storage service for retrieving todos
 * @returns Configured read todos tool
 */
export function createReadTodosTool(todoStorage: ITodoStorage): Tool {
  return {
    description: TOOL_DESCRIPTION,
    async execute(_input: unknown, context?: ToolExecutionContext): Promise<ReadTodosResult> {
      const sessionId = context?.sessionId ?? 'default'
      const todos = await todoStorage.get(sessionId)
      const incompleteCount = todos.filter((t) => t.status !== 'completed').length

      return {
        content: JSON.stringify(todos, null, 2),
        metadata: {todos},
        title: `${incompleteCount} todos`,
      }
    },
    id: ToolName.READ_TODOS,
    inputSchema: ReadTodosInputSchema,
  }
}
