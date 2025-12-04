import type {Todo} from '../../../core/domain/cipher/todos/types.js'

/**
 * ANSI color codes for terminal output.
 */
const Colors = {
  blue: '\u001B[34m',
  cyan: '\u001B[36m',
  dim: '\u001B[2m',
  green: '\u001B[32m',
  red: '\u001B[31m',
  reset: '\u001B[0m',
  yellow: '\u001B[33m',
} as const

/**
 * Gets the status icon for a todo.
 *
 * @param status - Todo status
 * @returns Colored status icon
 */
function getStatusIcon(status: Todo['status']): string {
  switch (status) {
    case 'cancelled': {
      return `${Colors.dim}⊘${Colors.reset}`
    }

    case 'completed': {
      return `${Colors.green}✓${Colors.reset}`
    }

    case 'in_progress': {
      return `${Colors.blue}→${Colors.reset}`
    }

    case 'pending': {
      return `${Colors.dim}○${Colors.reset}`
    }
  }
}

/**
 * Gets the status color for a todo.
 *
 * @param status - Todo status
 * @returns ANSI color code
 */
function getStatusColor(status: Todo['status']): string {
  switch (status) {
    case 'cancelled': {
      return Colors.dim
    }

    case 'completed': {
      return Colors.green
    }

    case 'in_progress': {
      return Colors.blue
    }

    case 'pending': {
      return Colors.dim
    }
  }
}

/**
 * Formats a single todo item for display.
 *
 * @param todo - Todo item to format
 * @param index - 1-based index of the todo
 * @returns Formatted todo string
 */
export function formatTodoItem(todo: Todo, index: number): string {
  const icon = getStatusIcon(todo.status)
  const color = getStatusColor(todo.status)
  const content = todo.status === 'in_progress' ? todo.activeForm : todo.content

  return `${icon} ${color}${index}. ${content}${Colors.reset}`
}

/**
 * Formats the entire todo list for display.
 *
 * @param todos - Array of todos to format
 * @returns Formatted todo list string
 */
export function formatTodoList(todos: Todo[]): string {
  if (todos.length === 0) {
    return `${Colors.dim}No tasks${Colors.reset}`
  }

  // Add each todo
  const lines = todos.map((todo, i) => formatTodoItem(todo, i + 1))

  // Add progress summary
  const stats = getTodoStats(todos)
  const summaryLines = ['', formatProgressBar(stats)]

  return [...lines, ...summaryLines].join('\n')
}

/**
 * Formats a compact progress bar.
 *
 * @param stats - Todo statistics
 * @returns Formatted progress bar string
 */
function formatProgressBar(stats: TodoStats): string {
  const percentage = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0
  const barWidth = 20
  const filled = Math.round((percentage / 100) * barWidth)
  const empty = barWidth - filled

  const bar = `${Colors.green}${'█'.repeat(filled)}${Colors.dim}${'░'.repeat(empty)}${Colors.reset}`

  return `${bar} ${percentage}% (${stats.completed}/${stats.total})`
}

/**
 * Todo statistics.
 */
interface TodoStats {
  cancelled: number
  completed: number
  inProgress: number
  pending: number
  total: number
}

/**
 * Gets statistics about the todo list.
 *
 * @param todos - Array of todos
 * @returns Statistics object
 */
function getTodoStats(todos: Todo[]): TodoStats {
  return {
    cancelled: todos.filter((t) => t.status === 'cancelled').length,
    completed: todos.filter((t) => t.status === 'completed').length,
    inProgress: todos.filter((t) => t.status === 'in_progress').length,
    pending: todos.filter((t) => t.status === 'pending').length,
    total: todos.length,
  }
}

/**
 * Formats a compact status line for the current task.
 *
 * @param todos - Array of todos
 * @returns Status line string or null if no task in progress
 */
export function formatCurrentTaskStatus(todos: Todo[]): null | string {
  const inProgress = todos.find((t) => t.status === 'in_progress')
  if (!inProgress) {
    return null
  }

  const stats = getTodoStats(todos)
  return `${Colors.blue}→${Colors.reset} ${inProgress.activeForm} ${Colors.dim}(${stats.completed + 1}/${stats.total})${Colors.reset}`
}
