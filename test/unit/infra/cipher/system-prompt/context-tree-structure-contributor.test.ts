import {expect} from 'chai'
import fs from 'node:fs'
import path from 'node:path'

import type {ContributorContext} from '../../../../../src/core/domain/cipher/system-prompt/types.js'

import {ContextTreeStructureContributor} from '../../../../../src/infra/cipher/system-prompt/contributors/context-tree-structure-contributor.js'

describe('ContextTreeStructureContributor', () => {
  let tempDir: string
  let contributor: ContextTreeStructureContributor

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-context-tree-'))
  })

  afterEach(() => {
    // Clean up temp directory
    if (tempDir) {
      fs.rmSync(tempDir, {force: true, recursive: true})
    }
  })

  describe('getContent', () => {
    it('should return empty string for chat command type', async () => {
      contributor = new ContextTreeStructureContributor('test', 10, {
        workingDirectory: tempDir,
      })

      const context: ContributorContext = {
        commandType: 'chat',
      }

      const result = await contributor.getContent(context)
      expect(result).to.equal('')
    })

    it('should return empty string when no command type is specified', async () => {
      contributor = new ContextTreeStructureContributor('test', 10, {
        workingDirectory: tempDir,
      })

      const context: ContributorContext = {}

      const result = await contributor.getContent(context)
      expect(result).to.equal('')
    })

    it('should return not initialized message when context tree does not exist', async () => {
      contributor = new ContextTreeStructureContributor('test', 10, {
        workingDirectory: tempDir,
      })

      const context: ContributorContext = {
        commandType: 'query',
      }

      const result = await contributor.getContent(context)
      expect(result).to.include('<context-tree-structure>')
      expect(result).to.include('Not Initialized')
      expect(result).to.include('/init')
    })

    it('should return empty message when context tree exists but is empty', async () => {
      // Create empty context tree
      const contextTreePath = path.join(tempDir, '.brv', 'context-tree')
      fs.mkdirSync(contextTreePath, {recursive: true})

      contributor = new ContextTreeStructureContributor('test', 10, {
        workingDirectory: tempDir,
      })

      const context: ContributorContext = {
        commandType: 'query',
      }

      const result = await contributor.getContent(context)
      expect(result).to.include('<context-tree-structure>')
      expect(result).to.include('Empty')
    })

    it('should return context tree structure for query command', async () => {
      // Create context tree with some content
      const contextTreePath = path.join(tempDir, '.brv', 'context-tree')
      const domainPath = path.join(contextTreePath, 'design')
      const topicPath = path.join(domainPath, 'auth-patterns')

      fs.mkdirSync(topicPath, {recursive: true})
      fs.writeFileSync(path.join(topicPath, 'context.md'), '# Authentication Patterns\n\nContent here...')

      contributor = new ContextTreeStructureContributor('test', 10, {
        workingDirectory: tempDir,
      })

      const context: ContributorContext = {
        commandType: 'query',
      }

      const result = await contributor.getContent(context)
      expect(result).to.include('<context-tree-structure>')
      expect(result).to.include('design/')
      expect(result).to.include('auth-patterns/')
      expect(result).to.include('context.md')
      expect(result).to.include('(knowledge content)')
      expect(result).to.include('</context-tree-structure>')
    })

    it('should return context tree structure for curate command', async () => {
      // Create context tree with some content
      const contextTreePath = path.join(tempDir, '.brv', 'context-tree')
      const domainPath = path.join(contextTreePath, 'structure')

      fs.mkdirSync(domainPath, {recursive: true})
      fs.writeFileSync(path.join(domainPath, 'api-architecture.md'), '# API Architecture\n\nContent...')

      contributor = new ContextTreeStructureContributor('test', 10, {
        workingDirectory: tempDir,
      })

      const context: ContributorContext = {
        commandType: 'curate',
      }

      const result = await contributor.getContent(context)
      expect(result).to.include('<context-tree-structure>')
      expect(result).to.include('structure/')
      expect(result).to.include('api-architecture.md')
      expect(result).to.include('</context-tree-structure>')
    })

    it('should include usage guidelines in output', async () => {
      // Create context tree with some content
      const contextTreePath = path.join(tempDir, '.brv', 'context-tree')
      const domainPath = path.join(contextTreePath, 'testing')

      fs.mkdirSync(domainPath, {recursive: true})
      fs.writeFileSync(path.join(domainPath, 'context.md'), '# Testing\n\nContent...')

      contributor = new ContextTreeStructureContributor('test', 10, {
        workingDirectory: tempDir,
      })

      const context: ContributorContext = {
        commandType: 'query',
      }

      const result = await contributor.getContent(context)
      expect(result).to.include('## Structure Guide')
      expect(result).to.include('## Usage')
      expect(result).to.include('Query commands')
      expect(result).to.include('Curate commands')
    })

    it('should respect maxEntries limit', async () => {
      // Create context tree with many files
      const contextTreePath = path.join(tempDir, '.brv', 'context-tree')
      const domainPath = path.join(contextTreePath, 'domain1')

      fs.mkdirSync(domainPath, {recursive: true})

      // Create more files than the limit
      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(path.join(domainPath, `topic${i}.md`), `# Topic ${i}\n\nContent...`)
      }

      contributor = new ContextTreeStructureContributor('test', 10, {
        maxEntries: 5,
        workingDirectory: tempDir,
      })

      const context: ContributorContext = {
        commandType: 'query',
      }

      const result = await contributor.getContent(context)
      expect(result).to.include('additional entries not shown')
    })

    it('should exclude hidden files starting with dot', async () => {
      // Create context tree with hidden file
      const contextTreePath = path.join(tempDir, '.brv', 'context-tree')
      const domainPath = path.join(contextTreePath, 'design')

      fs.mkdirSync(domainPath, {recursive: true})
      fs.writeFileSync(path.join(domainPath, 'visible.md'), '# Visible\n\nContent...')
      fs.writeFileSync(path.join(domainPath, '.hidden.md'), '# Hidden\n\nContent...')

      contributor = new ContextTreeStructureContributor('test', 10, {
        workingDirectory: tempDir,
      })

      const context: ContributorContext = {
        commandType: 'query',
      }

      const result = await contributor.getContent(context)
      expect(result).to.include('visible.md')
      expect(result).to.not.include('.hidden.md')
    })
  })

  describe('priority and id', () => {
    it('should have correct id and priority', () => {
      contributor = new ContextTreeStructureContributor('contextTree', 15, {
        workingDirectory: tempDir,
      })

      expect(contributor.id).to.equal('contextTree')
      expect(contributor.priority).to.equal(15)
    })
  })

  describe('search_knowledge tool integration', () => {
    it('should return search instructions when search_knowledge tool is available', async () => {
      // Create context tree with some content
      const contextTreePath = path.join(tempDir, '.brv', 'context-tree')
      const domainPath = path.join(contextTreePath, 'design')

      fs.mkdirSync(domainPath, {recursive: true})
      fs.writeFileSync(path.join(domainPath, 'context.md'), '# Design\n\nContent...')

      contributor = new ContextTreeStructureContributor('test', 10, {
        workingDirectory: tempDir,
      })

      const context: ContributorContext = {
        availableTools: ['search_knowledge', 'read_file'],
        commandType: 'query',
      }

      const result = await contributor.getContent(context)

      // Should contain search instructions instead of full tree
      expect(result).to.include('<context-tree-structure>')
      expect(result).to.include('search_knowledge')
      expect(result).to.include('Knowledge Base Available')
      expect(result).to.include('How to Search')
      // Should NOT contain full tree structure
      expect(result).to.not.include('design/')
      expect(result).to.not.include('context.md (knowledge content)')
    })

    it('should return full tree when search_knowledge tool is NOT available', async () => {
      // Create context tree with some content
      const contextTreePath = path.join(tempDir, '.brv', 'context-tree')
      const domainPath = path.join(contextTreePath, 'design')

      fs.mkdirSync(domainPath, {recursive: true})
      fs.writeFileSync(path.join(domainPath, 'context.md'), '# Design\n\nContent...')

      contributor = new ContextTreeStructureContributor('test', 10, {
        workingDirectory: tempDir,
      })

      const context: ContributorContext = {
        availableTools: ['read_file', 'write_file'], // No search_knowledge
        commandType: 'query',
      }

      const result = await contributor.getContent(context)

      // Should contain full tree structure
      expect(result).to.include('<context-tree-structure>')
      expect(result).to.include('design/')
      expect(result).to.include('context.md')
      expect(result).to.include('## Structure Guide')
    })

    it('should return full tree when availableTools is undefined', async () => {
      // Create context tree with some content
      const contextTreePath = path.join(tempDir, '.brv', 'context-tree')
      const domainPath = path.join(contextTreePath, 'design')

      fs.mkdirSync(domainPath, {recursive: true})
      fs.writeFileSync(path.join(domainPath, 'context.md'), '# Design\n\nContent...')

      contributor = new ContextTreeStructureContributor('test', 10, {
        workingDirectory: tempDir,
      })

      const context: ContributorContext = {
        commandType: 'query',
        // availableTools not specified
      }

      const result = await contributor.getContent(context)

      // Should contain full tree structure (fallback behavior)
      expect(result).to.include('design/')
      expect(result).to.include('context.md')
    })

    it('should return empty message when tree is empty even with search_knowledge available', async () => {
      // Create empty context tree
      const contextTreePath = path.join(tempDir, '.brv', 'context-tree')
      fs.mkdirSync(contextTreePath, {recursive: true})

      contributor = new ContextTreeStructureContributor('test', 10, {
        workingDirectory: tempDir,
      })

      const context: ContributorContext = {
        availableTools: ['search_knowledge'],
        commandType: 'query',
      }

      const result = await contributor.getContent(context)

      expect(result).to.include('Empty')
    })

    it('should include example queries in search instructions', async () => {
      // Create context tree with some content
      const contextTreePath = path.join(tempDir, '.brv', 'context-tree')
      const domainPath = path.join(contextTreePath, 'design')

      fs.mkdirSync(domainPath, {recursive: true})
      fs.writeFileSync(path.join(domainPath, 'context.md'), '# Design\n\nContent...')

      contributor = new ContextTreeStructureContributor('test', 10, {
        workingDirectory: tempDir,
      })

      const context: ContributorContext = {
        availableTools: ['search_knowledge'],
        commandType: 'query',
      }

      const result = await contributor.getContent(context)

      expect(result).to.include('Example Queries')
      expect(result).to.include('API design patterns')
    })

    it('should include curate instructions when search_knowledge is available for curate command', async () => {
      // Create context tree with some content
      const contextTreePath = path.join(tempDir, '.brv', 'context-tree')
      const domainPath = path.join(contextTreePath, 'design')

      fs.mkdirSync(domainPath, {recursive: true})
      fs.writeFileSync(path.join(domainPath, 'context.md'), '# Design\n\nContent...')

      contributor = new ContextTreeStructureContributor('test', 10, {
        workingDirectory: tempDir,
      })

      const context: ContributorContext = {
        availableTools: ['search_knowledge'],
        commandType: 'curate',
      }

      const result = await contributor.getContent(context)

      expect(result).to.include('For Curate Commands')
      expect(result).to.include('Search existing topics')
    })
  })
})
