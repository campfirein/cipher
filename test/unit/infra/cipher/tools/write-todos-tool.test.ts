import {expect} from 'chai'

import type {WriteTodosResult} from '../../../../../src/core/domain/cipher/todos/types.js'

import {createWriteTodosTool} from '../../../../../src/infra/cipher/tools/implementations/write-todos-tool.js'

describe('Write Todos Tool', () => {
  describe('execute', () => {
    it('should accept valid todos with different statuses', async () => {
      const tool = createWriteTodosTool()

      const result = (await tool.execute({
        todos: [
          {activeForm: 'Running tests', content: 'Run tests', status: 'completed'},
          {activeForm: 'Building project', content: 'Build project', status: 'in_progress'},
          {activeForm: 'Deploying to staging', content: 'Deploy to staging', status: 'pending'},
        ],
      })) as WriteTodosResult

      expect(result.llmContent).to.include('Todo list updated')
      expect(result.llmContent).to.include('Run tests')
      expect(result.llmContent).to.include('Build project')
      expect(result.llmContent).to.include('Deploy to staging')
      expect(result.returnDisplay.todos).to.have.length(3)
    })

    it('should reject when more than one task is in_progress', async () => {
      const tool = createWriteTodosTool()

      const result = await tool.execute({
        todos: [
          {activeForm: 'Running tests', content: 'Run tests', status: 'in_progress'},
          {activeForm: 'Building project', content: 'Build project', status: 'in_progress'},
        ],
      })

      expect(result).to.be.a('string')
      expect(result).to.include('Invalid parameters')
      expect(result).to.include('Only one task can be "in_progress"')
    })

    it('should accept exactly one in_progress task', async () => {
      const tool = createWriteTodosTool()

      const result = (await tool.execute({
        todos: [
          {activeForm: 'Running tests', content: 'Run tests', status: 'completed'},
          {activeForm: 'Building project', content: 'Build project', status: 'in_progress'},
          {activeForm: 'Deploying', content: 'Deploy', status: 'pending'},
        ],
      })) as WriteTodosResult

      expect(result.llmContent).to.include('Todo list updated')
      expect(result.llmContent).to.include('Currently: Building project')
    })

    it('should accept todos with no in_progress tasks', async () => {
      const tool = createWriteTodosTool()

      const result = (await tool.execute({
        todos: [
          {activeForm: 'Running tests', content: 'Run tests', status: 'completed'},
          {activeForm: 'Building project', content: 'Build project', status: 'pending'},
        ],
      })) as WriteTodosResult

      expect(result.llmContent).to.include('Todo list updated')
      expect(result.llmContent).not.to.include('Currently:')
    })

    it('should show progress statistics', async () => {
      const tool = createWriteTodosTool()

      const result = (await tool.execute({
        todos: [
          {activeForm: 'Task 1', content: 'Task 1', status: 'completed'},
          {activeForm: 'Task 2', content: 'Task 2', status: 'completed'},
          {activeForm: 'Task 3', content: 'Task 3', status: 'in_progress'},
          {activeForm: 'Task 4', content: 'Task 4', status: 'pending'},
        ],
      })) as WriteTodosResult

      expect(result.llmContent).to.include('Progress: 2/4 completed')
    })

    it('should handle cancelled tasks', async () => {
      const tool = createWriteTodosTool()

      const result = (await tool.execute({
        todos: [
          {activeForm: 'Task 1', content: 'Task 1', status: 'completed'},
          {activeForm: 'Task 2', content: 'Task 2', status: 'cancelled'},
        ],
      })) as WriteTodosResult

      expect(result.llmContent).to.include('Task 2')
      expect(result.returnDisplay.todos[1].status).to.equal('cancelled')
    })
  })

  describe('tool metadata', () => {
    it('should have correct id', () => {
      const tool = createWriteTodosTool()
      expect(tool.id).to.equal('write_todos')
    })

    it('should have input schema', () => {
      const tool = createWriteTodosTool()
      expect(tool.inputSchema).to.exist
    })

    it('should have description with usage guidance', () => {
      const tool = createWriteTodosTool()
      expect(tool.description).to.include('When to Use This Tool')
      expect(tool.description).to.include('When NOT to Use This Tool')
      expect(tool.description).to.include('Task States')
    })
  })
})
