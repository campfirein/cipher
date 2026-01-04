import { expect } from 'chai'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'

import { createCurateTool } from '../../../../../src/infra/cipher/tools/implementations/curate-tool.js'

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
    tmpDir = join(os.tmpdir(), `curate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    basePath = join(tmpDir, '.brv/context-tree')
    await fs.mkdir(basePath, { recursive: true })
  })

  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(tmpDir, { force: true, recursive: true })
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
                content: { snippets: ['test snippet'] },
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

    describe('Dynamic Domain Creation', () => {
      it('should allow creating multiple custom domains without limit', async () => {
        const tool = createCurateTool()

        // Create 5 custom domains - no limit anymore
        const results = await Promise.all(
          Array.from({ length: 5 }, async (_, index) => {
            const i = index + 1
            const result = (await tool.execute({
              basePath,
              operations: [
                {
                  content: { snippets: ['test'] },
                  path: `custom_domain_${i}/topic`,
                  reason: 'testing custom domain',
                  title: 'Test',
                  type: 'ADD',
                },
              ],
            })) as CurateOutput
            return { i, result }
          }),
        )

        for (const { i, result } of results) {
          expect(result.applied[0].status).to.equal('success', `Custom domain ${i} should succeed`)
        }

        // Verify all 5 domains exist
        const domains = await fs.readdir(basePath)
        const customDomains = domains.filter((d) => d.startsWith('custom_domain_'))
        expect(customDomains.length).to.equal(5)
      })

      it('should allow creating semantically meaningful domain names', async () => {
        const tool = createCurateTool()

        const meaningfulDomains = ['authentication', 'api_design', 'data_models', 'error_handling', 'ui_components']

        const results = await Promise.all(
          meaningfulDomains.map(async (domain) => {
            const result = (await tool.execute({
              basePath,
              operations: [
                {
                  content: { snippets: ['test content'] },
                  path: `${domain}/topic`,
                  reason: 'testing semantic domain',
                  title: 'Test',
                  type: 'ADD',
                },
              ],
            })) as CurateOutput
            return { domain, result }
          }),
        )

        for (const { domain, result } of results) {
          expect(result.applied[0].status).to.equal('success', `Domain ${domain} should succeed`)
        }

        // Verify all domains exist
        const domains = await fs.readdir(basePath)
        expect(domains).to.include.members(meaningfulDomains)
      })

      it('should allow reusing existing domains', async () => {
        const tool = createCurateTool()

        // Create a domain
        await tool.execute({
          basePath,
          operations: [
            {
              content: { snippets: ['test'] },
              path: 'authentication/login',
              reason: 'testing',
              title: 'Test',
              type: 'ADD',
            },
          ],
        })

        // Should be able to add more content to existing domain
        const result = (await tool.execute({
          basePath,
          operations: [
            {
              content: { snippets: ['more content'] },
              path: 'authentication/logout',
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
              content: { snippets: ['test'] },
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
          .access(join(basePath, 'code_style/error_handling/best_practices.md'))
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
            content: { snippets: ['test snippet'] },
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
            content: { snippets: ['original'] },
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
            content: { snippets: ['updated'] },
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
            content: { snippets: ['source content'] },
            path: 'code_style/old_topic',
            reason: 'create source',
            title: 'Old Guide',
            type: 'ADD',
          },
          {
            content: { snippets: ['target content'] },
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
            content: { snippets: ['updated'] },
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
            content: { snippets: ['test'] },
            path: 'code_style/error_handling',
            reason: 'testing naming',
            title: 'Best Practices for Errors',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')

      // Verify file was created with correct name
      const expectedPath = join(basePath, 'code_style/error_handling/best_practices_for_errors.md')
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
            content: { snippets: ['test'] },
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
            content: { snippets: ['subtopic content'] },
            path: 'code_style/error_handling/logging',
            reason: 'testing subtopic',
            title: 'Logging Best Practices',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')

      // Verify nested structure
      const expectedPath = join(basePath, 'code_style/error_handling/logging/logging_best_practices.md')
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
            content: { snippets: ['test'] },
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
            content: { snippets: ['test'] },
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
            content: { snippets: ['first'] },
            path: 'code_style/topic1',
            reason: 'add 1',
            title: 'First',
            type: 'ADD',
          },
          {
            content: { snippets: ['second'] },
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

  describe('Empty Directory Prevention (ENG-764)', () => {
    it('should NOT create empty directories when ADD operation fails due to invalid path', async () => {
      const tool = createCurateTool()

      // Attempt to add with invalid path (only one segment)
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            content: { snippets: ['test'] },
            path: 'invalid', // Invalid path - only one segment
            reason: 'testing',
            title: 'Test',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('failed')

      // Verify no directories were created
      const entries = await fs.readdir(basePath).catch(() => [])
      expect(entries.length).to.equal(0, 'No directories should be created on failed operation')
    })

    it('should NOT create empty directories when ADD operation fails due to missing title', async () => {
      const tool = createCurateTool()

      const result = (await tool.execute({
        basePath,
        operations: [
          {
            content: { snippets: ['test'] },
            path: 'code_style/new_topic',
            reason: 'testing',
            type: 'ADD',
            // Missing title
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('failed')

      // Verify code_style directory was not created
      const codeStyleExists = await fs
        .access(join(basePath, 'code_style'))
        .then(() => true)
        .catch(() => false)
      expect(codeStyleExists).to.be.false
    })

    it('should NOT create empty directories when ADD operation fails due to missing content', async () => {
      const tool = createCurateTool()

      const result = (await tool.execute({
        basePath,
        operations: [
          {
            path: 'design/patterns',
            reason: 'testing',
            title: 'Test',
            type: 'ADD',
            // Missing content
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('failed')

      // Verify design directory was not created
      const designExists = await fs
        .access(join(basePath, 'design'))
        .then(() => true)
        .catch(() => false)
      expect(designExists).to.be.false
    })


    it('should only create directories when file is successfully written', async () => {
      const tool = createCurateTool()

      // Fresh base path - no directories exist yet
      const freshBasePath = join(tmpDir, '.brv/fresh-context-tree')

      const result = (await tool.execute({
        basePath: freshBasePath,
        operations: [
          {
            content: { snippets: ['test content'] },
            path: 'code_style/error_handling/logging',
            reason: 'testing directory creation',
            title: 'Logging Guide',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')

      // Verify the file exists
      const filePath = join(freshBasePath, 'code_style/error_handling/logging/logging_guide.md')
      const fileExists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false)
      expect(fileExists).to.be.true

      // Verify parent directories exist (they should be created along with the file)
      const loggingDirExists = await fs
        .access(join(freshBasePath, 'code_style/error_handling/logging'))
        .then(() => true)
        .catch(() => false)
      expect(loggingDirExists).to.be.true
    })
  })
})
