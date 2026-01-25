import {expect} from 'chai'

import type {Todo, WriteTodosResult} from '../../../../src/agent/types/todos/types.js'
import type {ITodoStorage} from '../../../../src/agent/interfaces/i-todo-storage.js'

import {createWriteTodosTool} from '../../../../src/agent/tools/implementations/write-todos-tool.js'

/**
 * Creates a mock ITodoStorage for testing.
 */
function createMockTodoStorage(): ITodoStorage {
  const storage = new Map<string, Todo[]>()
  return {
    async get(sessionId: string): Promise<Todo[]> {
      return storage.get(sessionId) ?? []
    },
    async update(sessionId: string, todos: Todo[]): Promise<void> {
      storage.set(sessionId, todos)
    },
  }
}

describe('Write Todos Tool', () => {
  describe('execute', () => {
    it('should accept valid todos with different statuses', async () => {
      const tool = createWriteTodosTool(createMockTodoStorage())

      const result = (await tool.execute({
        todos: [
          {activeForm: 'Running tests', content: 'Run tests', id: '1', status: 'completed'},
          {activeForm: 'Building project', content: 'Build project', id: '2', status: 'in_progress'},
          {activeForm: 'Deploying to staging', content: 'Deploy to staging', id: '3', status: 'pending'},
        ],
      })) as WriteTodosResult

      expect(result.llmContent).to.include('Todo list updated')
      expect(result.llmContent).to.include('Run tests')
      expect(result.llmContent).to.include('Build project')
      expect(result.llmContent).to.include('Deploy to staging')
      expect(result.returnDisplay.todos).to.have.length(3)
    })

    it('should reject when more than one task is in_progress', async () => {
      const tool = createWriteTodosTool(createMockTodoStorage())

      const result = await tool.execute({
        todos: [
          {activeForm: 'Running tests', content: 'Run tests', id: '1', status: 'in_progress'},
          {activeForm: 'Building project', content: 'Build project', id: '2', status: 'in_progress'},
        ],
      })

      expect(result).to.be.a('string')
      expect(result).to.include('Invalid parameters')
      expect(result).to.include('Only one task can be "in_progress"')
    })

    it('should accept exactly one in_progress task', async () => {
      const tool = createWriteTodosTool(createMockTodoStorage())

      const result = (await tool.execute({
        todos: [
          {activeForm: 'Running tests', content: 'Run tests', id: '1', status: 'completed'},
          {activeForm: 'Building project', content: 'Build project', id: '2', status: 'in_progress'},
          {activeForm: 'Deploying', content: 'Deploy', id: '3', status: 'pending'},
        ],
      })) as WriteTodosResult

      expect(result.llmContent).to.include('Todo list updated')
      expect(result.llmContent).to.include('Currently: Building project')
    })

    it('should accept todos with no in_progress tasks', async () => {
      const tool = createWriteTodosTool(createMockTodoStorage())

      const result = (await tool.execute({
        todos: [
          {activeForm: 'Running tests', content: 'Run tests', id: '1', status: 'completed'},
          {activeForm: 'Building project', content: 'Build project', id: '2', status: 'pending'},
        ],
      })) as WriteTodosResult

      expect(result.llmContent).to.include('Todo list updated')
      expect(result.llmContent).not.to.include('Currently:')
    })

    it('should show progress statistics', async () => {
      const tool = createWriteTodosTool(createMockTodoStorage())

      const result = (await tool.execute({
        todos: [
          {activeForm: 'Task 1', content: 'Task 1', id: '1', status: 'completed'},
          {activeForm: 'Task 2', content: 'Task 2', id: '2', status: 'completed'},
          {activeForm: 'Task 3', content: 'Task 3', id: '3', status: 'in_progress'},
          {activeForm: 'Task 4', content: 'Task 4', id: '4', status: 'pending'},
        ],
      })) as WriteTodosResult

      expect(result.llmContent).to.include('Progress: 2/4 completed')
    })

    it('should handle cancelled tasks', async () => {
      const tool = createWriteTodosTool(createMockTodoStorage())

      const result = (await tool.execute({
        todos: [
          {activeForm: 'Task 1', content: 'Task 1', id: '1', status: 'completed'},
          {activeForm: 'Task 2', content: 'Task 2', id: '2', status: 'cancelled'},
        ],
      })) as WriteTodosResult

      expect(result.llmContent).to.include('Task 2')
      expect(result.returnDisplay.todos[1].status).to.equal('cancelled')
    })
  })

  describe('tool metadata', () => {
    it('should have correct id', () => {
      const tool = createWriteTodosTool(createMockTodoStorage())
      expect(tool.id).to.equal('write_todos')
    })

    it('should have input schema', () => {
      const tool = createWriteTodosTool(createMockTodoStorage())
      expect(tool.inputSchema).to.exist
    })

    it('should have description with usage guidance', () => {
      const tool = createWriteTodosTool(createMockTodoStorage())
      expect(tool.description).to.include('task list')
    })
  })
})
