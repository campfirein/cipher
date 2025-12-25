import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import {expect} from 'chai'

import {createCurateTool} from '../../../../../src/infra/cipher/tools/implementations/curate-tool.js'

interface CurateOutput {
  applied: Array<{
    filePath?: string
    message?: string
    path: string
    status: 'failed' | 'success'
    type: 'ADD' | 'DELETE' | 'MERGE' | 'UPDATE'
  }>
  summary: {
    added: number
    deleted: number
    failed: number
    merged: number
    updated: number
  }
}

describe('Curate Tool', () => {
  let tmpDir: string
  let basePath: string

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tmpDir = path.join(os.tmpdir(), `curate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    basePath = path.join(tmpDir, '.brv/context-tree')
    await fs.mkdir(basePath, {recursive: true})
  })

  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(tmpDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('Domain Validation', () => {
    describe('Predefined Domains', () => {
      const predefinedDomains = ['code_style', 'design', 'structure', 'compliance', 'testing', 'bug_fixes']

      for (const domain of predefinedDomains) {
        it(`should allow creating context in predefined domain: ${domain}`, async () => {
          const tool = createCurateTool()
          const result = (await tool.execute({
            basePath,
            operations: [
              {
                content: {snippets: ['test snippet']},
                path: `${domain}/test_topic`,
                reason: 'testing predefined domain',
                title: 'Test Context',
                type: 'ADD',
              },
            ],
          })) as CurateOutput

          expect(result.applied[0].status).to.equal('success')
          expect(result.summary.added).to.equal(1)
          expect(result.summary.failed).to.equal(0)
        })
      }
    })

    describe('Custom Domain Limits', () => {
      it('should allow up to 3 custom domains', async () => {
        const tool = createCurateTool()

        // Create 3 custom domains
        for (let i = 1; i <= 3; i++) {
          const result = (await tool.execute({
            basePath,
            operations: [
              {
                content: {snippets: ['test']},
                path: `custom_domain_${i}/topic`,
                reason: 'testing custom domain',
                title: 'Test',
                type: 'ADD',
              },
            ],
          })) as CurateOutput

          expect(result.applied[0].status).to.equal('success', `Custom domain ${i} should succeed`)
        }

        // Verify all 3 domains exist
        const domains = await fs.readdir(basePath)
        const customDomains = domains.filter((d) => d.startsWith('custom_domain_'))
        expect(customDomains.length).to.equal(3)
      })

      it('should reject 4th custom domain with descriptive error', async () => {
        const tool = createCurateTool()

        // First create 3 custom domains
        for (let i = 1; i <= 3; i++) {
          await tool.execute({
            basePath,
            operations: [
              {
                content: {snippets: ['test']},
                path: `custom_domain_${i}/topic`,
                reason: 'testing',
                title: 'Test',
                type: 'ADD',
              },
            ],
          })
        }

        // Try to create 4th custom domain
        const result = (await tool.execute({
          basePath,
          operations: [
            {
              content: {snippets: ['test']},
              path: 'custom_domain_4/topic',
              reason: 'testing',
              title: 'Test',
              type: 'ADD',
            },
          ],
        })) as CurateOutput

        expect(result.applied[0].status).to.equal('failed')
        expect(result.applied[0].message).to.include('Maximum of 3 custom domains allowed')
        expect(result.applied[0].message).to.include('custom_domain_1')
        expect(result.applied[0].message).to.include('custom_domain_2')
        expect(result.applied[0].message).to.include('custom_domain_3')
        expect(result.summary.failed).to.equal(1)
      })

      it('should allow predefined domains even after 3 custom domains exist', async () => {
        const tool = createCurateTool()

        // Create 3 custom domains first
        for (let i = 1; i <= 3; i++) {
          await tool.execute({
            basePath,
            operations: [
              {
                content: {snippets: ['test']},
                path: `custom_domain_${i}/topic`,
                reason: 'testing',
                title: 'Test',
                type: 'ADD',
              },
            ],
          })
        }

        // Should still be able to create in predefined domains
        const result = (await tool.execute({
          basePath,
          operations: [
            {
              content: {snippets: ['code style rules']},
              path: 'code_style/formatting',
              reason: 'testing predefined after custom',
              title: 'Code Style Rules',
              type: 'ADD',
            },
          ],
        })) as CurateOutput

        expect(result.applied[0].status).to.equal('success')
      })

      it('should allow reusing existing custom domains even at limit', async () => {
        const tool = createCurateTool()

        // Create 3 custom domains
        for (let i = 1; i <= 3; i++) {
          await tool.execute({
            basePath,
            operations: [
              {
                content: {snippets: ['test']},
                path: `custom_domain_${i}/topic`,
                reason: 'testing',
                title: 'Test',
                type: 'ADD',
              },
            ],
          })
        }

        // Should be able to add more content to existing custom domain
        const result = (await tool.execute({
          basePath,
          operations: [
            {
              content: {snippets: ['more content']},
              path: 'custom_domain_1/another_topic',
              reason: 'testing reuse',
              title: 'Another Test',
              type: 'ADD',
            },
          ],
        })) as CurateOutput

        expect(result.applied[0].status).to.equal('success')
      })
    })

    describe('Domain Name Normalization', () => {
      it('should normalize domain names to snake_case', async () => {
        const tool = createCurateTool()

        const result = (await tool.execute({
          basePath,
          operations: [
            {
              content: {snippets: ['test']},
              path: 'Code Style/error-handling',
              reason: 'testing normalization',
              title: 'Best Practices',
              type: 'ADD',
            },
          ],
        })) as CurateOutput

        expect(result.applied[0].status).to.equal('success')
        // Should create in normalized path
        const exists = await fs
          .access(path.join(basePath, 'code_style/error_handling/best_practices.md'))
          .then(() => true)
          .catch(() => false)
        expect(exists).to.be.true
      })
    })
  })

  describe('File Path Return', () => {
    it('should return filePath on successful ADD operation', async () => {
      const tool = createCurateTool()

      const result = (await tool.execute({
        basePath,
        operations: [
          {
            content: {snippets: ['test snippet']},
            path: 'code_style/formatting',
            reason: 'testing filePath',
            title: 'Formatting Rules',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      expect(result.applied[0].filePath).to.be.a('string')
      expect(result.applied[0].filePath).to.include('code_style')
      expect(result.applied[0].filePath).to.include('formatting')
      expect(result.applied[0].filePath).to.include('formatting_rules.md')
    })

    it('should return filePath on successful UPDATE operation', async () => {
      const tool = createCurateTool()

      // First create the file
      await tool.execute({
        basePath,
        operations: [
          {
            content: {snippets: ['original']},
            path: 'code_style/formatting',
            reason: 'create',
            title: 'Formatting Rules',
            type: 'ADD',
          },
        ],
      })

      // Then update it
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            content: {snippets: ['updated']},
            path: 'code_style/formatting',
            reason: 'update',
            title: 'Formatting Rules',
            type: 'UPDATE',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      expect(result.applied[0].filePath).to.include('formatting_rules.md')
    })

    it('should return target filePath on successful MERGE operation', async () => {
      const tool = createCurateTool()

      // Create source and target files
      await tool.execute({
        basePath,
        operations: [
          {
            content: {snippets: ['source content']},
            path: 'code_style/old_topic',
            reason: 'create source',
            title: 'Old Guide',
            type: 'ADD',
          },
          {
            content: {snippets: ['target content']},
            path: 'code_style/new_topic',
            reason: 'create target',
            title: 'New Guide',
            type: 'ADD',
          },
        ],
      })

      // Merge
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            mergeTarget: 'code_style/new_topic',
            mergeTargetTitle: 'New Guide',
            path: 'code_style/old_topic',
            reason: 'consolidating',
            title: 'Old Guide',
            type: 'MERGE',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      expect(result.applied[0].filePath).to.include('new_topic')
      expect(result.applied[0].filePath).to.include('new_guide.md')
    })

    it('should NOT return filePath on failed operation', async () => {
      const tool = createCurateTool()

      // Try to update non-existent file
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            content: {snippets: ['updated']},
            path: 'code_style/nonexistent',
            reason: 'update',
            title: 'Nonexistent',
            type: 'UPDATE',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('failed')
      expect(result.applied[0].filePath).to.be.undefined
    })
  })

  describe('Dynamic Context Naming', () => {
    it('should create files with title.md format in snake_case', async () => {
      const tool = createCurateTool()

      const result = (await tool.execute({
        basePath,
        operations: [
          {
            content: {snippets: ['test']},
            path: 'code_style/error_handling',
            reason: 'testing naming',
            title: 'Best Practices for Errors',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')

      // Verify file was created with correct name
      const expectedPath = path.join(basePath, 'code_style/error_handling/best_practices_for_errors.md')
      const exists = await fs
        .access(expectedPath)
        .then(() => true)
        .catch(() => false)
      expect(exists).to.be.true
    })

    it('should handle special characters in title', async () => {
      const tool = createCurateTool()

      const result = (await tool.execute({
        basePath,
        operations: [
          {
            content: {snippets: ['test']},
            path: 'code_style/formatting',
            reason: 'testing special chars',
            title: 'Error-Handling & Best_Practices',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      // Should normalize to snake_case
      expect(result.applied[0].filePath).to.include('.md')
    })
  })

  describe('Subtopic Support', () => {
    it('should support domain/topic/subtopic path format', async () => {
      const tool = createCurateTool()

      const result = (await tool.execute({
        basePath,
        operations: [
          {
            content: {snippets: ['subtopic content']},
            path: 'code_style/error_handling/logging',
            reason: 'testing subtopic',
            title: 'Logging Best Practices',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')

      // Verify nested structure
      const expectedPath = path.join(basePath, 'code_style/error_handling/logging/logging_best_practices.md')
      const exists = await fs
        .access(expectedPath)
        .then(() => true)
        .catch(() => false)
      expect(exists).to.be.true
    })
  })

  describe('Operation Validation', () => {
    it('should fail ADD without title', async () => {
      const tool = createCurateTool()

      const result = (await tool.execute({
        basePath,
        operations: [
          {
            content: {snippets: ['test']},
            path: 'code_style/topic',
            reason: 'testing',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('failed')
      expect(result.applied[0].message).to.include('requires a title')
    })

    it('should fail ADD without content', async () => {
      const tool = createCurateTool()

      const result = (await tool.execute({
        basePath,
        operations: [
          {
            path: 'code_style/topic',
            reason: 'testing',
            title: 'Test',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('failed')
      expect(result.applied[0].message).to.include('requires content')
    })

    it('should fail with invalid path format', async () => {
      const tool = createCurateTool()

      const result = (await tool.execute({
        basePath,
        operations: [
          {
            content: {snippets: ['test']},
            path: 'invalid', // Only one segment
            reason: 'testing',
            title: 'Test',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('failed')
      expect(result.applied[0].message).to.include('Invalid path format')
    })
  })

  describe('Multiple Operations', () => {
    it('should process multiple operations and return accurate summary', async () => {
      const tool = createCurateTool()

      const result = (await tool.execute({
        basePath,
        operations: [
          {
            content: {snippets: ['first']},
            path: 'code_style/topic1',
            reason: 'add 1',
            title: 'First',
            type: 'ADD',
          },
          {
            content: {snippets: ['second']},
            path: 'design/topic2',
            reason: 'add 2',
            title: 'Second',
            type: 'ADD',
          },
          {
            path: 'invalid',
            reason: 'should fail',
            title: 'Fail',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.summary.added).to.equal(2)
      expect(result.summary.failed).to.equal(1)
      expect(result.applied.length).to.equal(3)
    })
  })
})
