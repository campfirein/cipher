import { expect } from 'chai'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backfillDomainContextFiles, createCurateTool } from '../../../../src/agent/infra/tools/implementations/curate-tool.js'

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

/**
 * Helper to check if a file/directory exists.
 * Extracted to avoid nested callback lint errors.
 */
async function pathExists(path: string): Promise<boolean> {
  return fs
    .access(path)
    .then(() => true)
    .catch(() => false)
}

/**
 * Count directories matching a prefix using for...of (avoids nested callback).
 */
function countByPrefix(items: string[], prefix: string): number {
  let count = 0
  for (const item of items) {
    if (item.startsWith(prefix)) count++
  }

  return count
}

describe('Curate Tool', () => {
  let tmpDir: string
  let basePath: string

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tmpDir = join(tmpdir(), `curate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

        // Build promise array imperatively to avoid nested callbacks
        const domainIndices = [1, 2, 3, 4, 5]
        const promises: Array<ReturnType<typeof tool.execute>> = []
        for (const i of domainIndices) {
          promises.push(
            tool.execute({
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
            }),
          )
        }

        const results = (await Promise.all(promises)) as CurateOutput[]

        // Verify all operations succeeded
        for (const [idx, result] of results.entries()) {
          expect(result.applied[0].status).to.equal('success', `Custom domain ${domainIndices[idx]} should succeed`)
        }

        // Verify all 5 domains exist
        const domains = await fs.readdir(basePath)
        expect(countByPrefix(domains, 'custom_domain_')).to.equal(5)
      })

      it('should allow creating semantically meaningful domain names', async () => {
        const tool = createCurateTool()
        const semanticDomains = ['authentication', 'api_design', 'error_handling', 'caching']

        // Build promise array imperatively to avoid nested callbacks
        const promises: Array<ReturnType<typeof tool.execute>> = []
        for (const domain of semanticDomains) {
          promises.push(
            tool.execute({
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
            }),
          )
        }

        const results = (await Promise.all(promises)) as CurateOutput[]

        // Verify all operations succeeded
        for (const [idx, result] of results.entries()) {
          expect(result.applied[0].status).to.equal('success', `Domain ${semanticDomains[idx]} should succeed`)
        }

        // Verify all semantic domains exist
        const domains = await fs.readdir(basePath)
        for (const domain of semanticDomains) {
          expect(domains).to.include(domain)
        }
      })

      it('should allow predefined domains alongside custom domains', async () => {
        const tool = createCurateTool()

        // Create some custom domains first
        /* eslint-disable no-await-in-loop -- Sequential domain creation required for test */
        for (let i = 1; i <= 3; i++) {
          await tool.execute({
            basePath,
            operations: [
              {
                content: { snippets: ['test'] },
                path: `custom_domain_${i}/topic`,
                reason: 'testing',
                title: 'Test',
                type: 'ADD',
              },
            ],
          })
        }
        /* eslint-enable no-await-in-loop */

        // Should be able to create in predefined domains
        const result = (await tool.execute({
          basePath,
          operations: [
            {
              content: { snippets: ['code style rules'] },
              path: 'code_style/formatting',
              reason: 'testing predefined after custom',
              title: 'Code Style Rules',
              type: 'ADD',
            },
          ],
        })) as CurateOutput

        expect(result.applied[0].status).to.equal('success')
      })

      it('should allow adding multiple topics to existing custom domains', async () => {
        const tool = createCurateTool()

        // Create a custom domain
        await tool.execute({
          basePath,
          operations: [
            {
              content: { snippets: ['test'] },
              path: 'authentication/login',
              reason: 'testing',
              title: 'Login Flow',
              type: 'ADD',
            },
          ],
        })

        // Should be able to add more topics to the same custom domain
        const result = (await tool.execute({
          basePath,
          operations: [
            {
              content: { snippets: ['logout content'] },
              path: 'authentication/logout',
              reason: 'testing additional topic',
              title: 'Logout Flow',
              type: 'ADD',
            },
          ],
        })) as CurateOutput

        expect(result.applied[0].status).to.equal('success')

        // Verify both topics exist under authentication
        const authDir = await fs.readdir(join(basePath, 'authentication'))
        expect(authDir).to.include('login')
        expect(authDir).to.include('logout')
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
        const exists = await pathExists(join(basePath, 'code_style/error_handling/best_practices.md'))
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
      const exists = await pathExists(expectedPath)
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
      const exists = await pathExists(expectedPath)
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

  describe('Domain Context Auto-Creation (ENG-921)', () => {
    describe('ADD operation', () => {
      it('should auto-create domain context.md with agent-provided domainContext', async () => {
        const tool = createCurateTool()

        const result = (await tool.execute({
          basePath,
          operations: [
            {
              content: { snippets: ['test content'] },
              domainContext: {
                ownership: 'Platform Security Team',
                purpose: 'Contains all knowledge related to user and service authentication mechanisms.',
                scope: {
                  excluded: ['Authorization and permission models', 'User profile management'],
                  included: ['Login and signup flows', 'Token-based authentication', 'OAuth integrations'],
                },
                usage: 'Use this domain for documenting authentication flows and identity verification.',
              },
              path: 'authentication/jwt',
              reason: 'testing domain context creation',
              title: 'Token Handling',
              type: 'ADD',
            },
          ],
        })) as CurateOutput

        expect(result.applied[0].status).to.equal('success')

        // Verify domain context.md was created
        const contextMdPath = join(basePath, 'authentication/context.md')
        const contextMdExists = await pathExists(contextMdPath)
        expect(contextMdExists).to.be.true

        // Verify content structure
        const content = await fs.readFile(contextMdPath, 'utf8')
        expect(content).to.include('# Domain: authentication')
        expect(content).to.include('## Purpose')
        expect(content).to.include('Contains all knowledge related to user and service authentication mechanisms.')
        expect(content).to.include('## Scope')
        expect(content).to.include('Login and signup flows')
        expect(content).to.include('Token-based authentication')
        expect(content).to.include('Authorization and permission models')
        expect(content).to.include('## Ownership')
        expect(content).to.include('Platform Security Team')
        expect(content).to.include('## Usage')
      })

      it('should auto-create minimal domain context.md when domainContext not provided', async () => {
        const tool = createCurateTool()

        const result = (await tool.execute({
          basePath,
          operations: [
            {
              content: { snippets: ['test content'] },
              path: 'caching/redis',
              reason: 'testing minimal context creation',
              title: 'Redis Setup',
              type: 'ADD',
            },
          ],
        })) as CurateOutput

        expect(result.applied[0].status).to.equal('success')

        // Verify domain context.md was created with minimal template
        const contextMdPath = join(basePath, 'caching/context.md')
        const contextMdExists = await pathExists(contextMdPath)
        expect(contextMdExists).to.be.true

        // Verify minimal template structure
        const content = await fs.readFile(contextMdPath, 'utf8')
        expect(content).to.include('# Domain: caching')
        expect(content).to.include('## Purpose')
        expect(content).to.include('Describe what this domain represents')
        expect(content).to.include('## Scope')
        expect(content).to.include('## Ownership')
        expect(content).to.include('## Usage')
      })

      it('should NOT overwrite existing domain context.md', async () => {
        const tool = createCurateTool()

        // First, create a domain with specific context
        await tool.execute({
          basePath,
          operations: [
            {
              content: { snippets: ['first content'] },
              domainContext: {
                purpose: 'Original purpose description.',
                scope: {
                  included: ['Original included item'],
                },
              },
              path: 'testing/unit',
              reason: 'first add',
              title: 'First Topic',
              type: 'ADD',
            },
          ],
        })

        // Verify original content
        const contextMdPath = join(basePath, 'testing/context.md')
        const originalContent = await fs.readFile(contextMdPath, 'utf8')
        expect(originalContent).to.include('Original purpose description.')

        // Add another topic to the same domain with different domainContext
        const result = (await tool.execute({
          basePath,
          operations: [
            {
              content: { snippets: ['second content'] },
              domainContext: {
                purpose: 'This should NOT overwrite the original.',
                scope: {
                  included: ['New included item'],
                },
              },
              path: 'testing/integration',
              reason: 'second add',
              title: 'Second Topic',
              type: 'ADD',
            },
          ],
        })) as CurateOutput

        expect(result.applied[0].status).to.equal('success')

        // Verify original context.md was NOT overwritten
        const currentContent = await fs.readFile(contextMdPath, 'utf8')
        expect(currentContent).to.include('Original purpose description.')
        expect(currentContent).to.not.include('This should NOT overwrite the original.')
      })
    })

    describe('UPDATE operation', () => {
      it('should create domain context.md if missing during UPDATE', async () => {
        const tool = createCurateTool()

        // First create a topic without triggering context.md creation
        // by directly creating the file structure
        const topicDir = join(basePath, 'api_design/endpoints')
        await fs.mkdir(topicDir, { recursive: true })
        await fs.writeFile(join(topicDir, 'rest_api.md'), 'original content')

        // Now update it - should trigger context.md creation
        const result = (await tool.execute({
          basePath,
          operations: [
            {
              content: { snippets: ['updated content'] },
              domainContext: {
                purpose: 'API design patterns and guidelines.',
                scope: {
                  included: ['REST API endpoints', 'GraphQL schemas'],
                },
              },
              path: 'api_design/endpoints',
              reason: 'updating with domain context',
              title: 'Rest Api',
              type: 'UPDATE',
            },
          ],
        })) as CurateOutput

        expect(result.applied[0].status).to.equal('success')

        // Verify domain context.md was created
        const contextMdPath = join(basePath, 'api_design/context.md')
        const contextMdExists = await pathExists(contextMdPath)
        expect(contextMdExists).to.be.true

        const content = await fs.readFile(contextMdPath, 'utf8')
        expect(content).to.include('API design patterns and guidelines.')
      })
    })

    describe('MERGE operation', () => {
      it('should create domain context.md for both source and target domains if missing', async () => {
        const tool = createCurateTool()

        // Create source and target files manually (without context.md)
        const sourceDir = join(basePath, 'old_domain/old_topic')
        const targetDir = join(basePath, 'new_domain/new_topic')
        await fs.mkdir(sourceDir, { recursive: true })
        await fs.mkdir(targetDir, { recursive: true })
        await fs.writeFile(join(sourceDir, 'source_file.md'), 'source content')
        await fs.writeFile(join(targetDir, 'target_file.md'), 'target content')

        // Perform merge
        const result = (await tool.execute({
          basePath,
          operations: [
            {
              domainContext: {
                purpose: 'Shared domain context for merge test.',
                scope: {
                  included: ['Merged content'],
                },
              },
              mergeTarget: 'new_domain/new_topic',
              mergeTargetTitle: 'Target File',
              path: 'old_domain/old_topic',
              reason: 'consolidating domains',
              title: 'Source File',
              type: 'MERGE',
            },
          ],
        })) as CurateOutput

        expect(result.applied[0].status).to.equal('success')

        // Verify both domain context.md files were created
        const sourceContextPath = join(basePath, 'old_domain/context.md')
        const targetContextPath = join(basePath, 'new_domain/context.md')

        expect(await pathExists(sourceContextPath)).to.be.true
        expect(await pathExists(targetContextPath)).to.be.true
      })
    })

    describe('Domain context content validation', () => {
      it('should include all provided domainContext fields', async () => {
        const tool = createCurateTool()

        await tool.execute({
          basePath,
          operations: [
            {
              content: { snippets: ['test'] },
              domainContext: {
                ownership: 'Core Infrastructure Team\nMaintained by DevOps group.',
                purpose: 'Database connection and query patterns.',
                scope: {
                  excluded: ['Application business logic', 'UI components'],
                  included: ['Connection pooling', 'Query optimization', 'Migration scripts'],
                },
                usage: 'Backend engineers should reference this domain when:\n- Setting up new database connections\n- Writing complex queries\n- Creating migrations',
              },
              path: 'database/connections',
              reason: 'full domainContext test',
              title: 'Connection Pool',
              type: 'ADD',
            },
          ],
        })

        const contextMdPath = join(basePath, 'database/context.md')
        const content = await fs.readFile(contextMdPath, 'utf8')

        // Verify all sections
        expect(content).to.include('# Domain: database')
        expect(content).to.include('Database connection and query patterns.')
        expect(content).to.include('Connection pooling')
        expect(content).to.include('Query optimization')
        expect(content).to.include('Migration scripts')
        expect(content).to.include('Application business logic')
        expect(content).to.include('UI components')
        expect(content).to.include('Core Infrastructure Team')
        expect(content).to.include('Backend engineers should reference this domain when:')
      })

      it('should handle domainContext with only required fields', async () => {
        const tool = createCurateTool()

        await tool.execute({
          basePath,
          operations: [
            {
              content: { snippets: ['test'] },
              domainContext: {
                purpose: 'Minimal domain with only required fields.',
                scope: {
                  included: ['Required item 1', 'Required item 2'],
                },
              },
              path: 'minimal_domain/topic',
              reason: 'minimal domainContext test',
              title: 'Test Topic',
              type: 'ADD',
            },
          ],
        })

        const contextMdPath = join(basePath, 'minimal_domain/context.md')
        const content = await fs.readFile(contextMdPath, 'utf8')

        expect(content).to.include('# Domain: minimal_domain')
        expect(content).to.include('Minimal domain with only required fields.')
        expect(content).to.include('Required item 1')
        expect(content).to.include('Required item 2')
        // Optional sections should not appear if not provided
        expect(content).to.not.include('## Ownership')
        expect(content).to.not.include('## Usage')
      })
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
      const codeStyleExists = await pathExists(join(basePath, 'code_style'))
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
      const designExists = await pathExists(join(basePath, 'design'))
      expect(designExists).to.be.false
    })

    it('should NOT create empty directories when ADD fails due to empty domain name', async () => {
      const tool = createCurateTool()

      // Try to add with an empty domain path segment (should fail)
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            content: { snippets: ['test'] },
            path: '/topic', // Invalid - empty domain
            reason: 'testing empty domain',
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
      const fileExists = await pathExists(filePath)
      expect(fileExists).to.be.true

      // Verify parent directories exist (they should be created along with the file)
      const loggingDirExists = await pathExists(join(freshBasePath, 'code_style/error_handling/logging'))
      expect(loggingDirExists).to.be.true
    })
  })

  describe('backfillDomainContextFiles', () => {
    it('should return empty array when basePath does not exist', async () => {
      const nonExistentPath = join(tmpDir, 'non-existent')
      const result = await backfillDomainContextFiles(nonExistentPath)
      expect(result).to.deep.equal([])
    })

    it('should return empty array when there are no domains', async () => {
      const result = await backfillDomainContextFiles(basePath)
      expect(result).to.deep.equal([])
    })

    it('should not create context.md for empty domains (no .md files)', async () => {
      // Create an empty domain directory
      await fs.mkdir(join(basePath, 'empty_domain'), { recursive: true })

      const result = await backfillDomainContextFiles(basePath)
      expect(result).to.deep.equal([])

      // Verify no context.md was created
      const contextMdExists = await pathExists(join(basePath, 'empty_domain/context.md'))
      expect(contextMdExists).to.be.false
    })

    it('should create context.md for domains with content but missing context.md', async () => {
      // Create a domain with content but no context.md
      const domainPath = join(basePath, 'existing_domain/some_topic')
      await fs.mkdir(domainPath, { recursive: true })
      await fs.writeFile(join(domainPath, 'some_knowledge.md'), '# Some Knowledge\n\nContent here')

      const result = await backfillDomainContextFiles(basePath)

      expect(result).to.have.lengthOf(1)
      expect(result[0]).to.equal(join(basePath, 'existing_domain/context.md'))

      // Verify context.md was created with minimal template
      const contextMdPath = join(basePath, 'existing_domain/context.md')
      const contextMdExists = await pathExists(contextMdPath)
      expect(contextMdExists).to.be.true

      const content = await fs.readFile(contextMdPath, 'utf8')
      expect(content).to.include('# Domain: existing_domain')
      expect(content).to.include('## Purpose')
      expect(content).to.include('## Scope')
    })

    it('should skip domains that already have context.md', async () => {
      // Create a domain with existing context.md
      const domainPath = join(basePath, 'complete_domain')
      await fs.mkdir(domainPath, { recursive: true })
      await fs.writeFile(join(domainPath, 'context.md'), '# Existing context')
      await fs.mkdir(join(domainPath, 'topic'), { recursive: true })
      await fs.writeFile(join(domainPath, 'topic/knowledge.md'), '# Knowledge')

      const result = await backfillDomainContextFiles(basePath)
      expect(result).to.deep.equal([])

      // Verify original context.md is unchanged
      const content = await fs.readFile(join(domainPath, 'context.md'), 'utf8')
      expect(content).to.equal('# Existing context')
    })

    it('should backfill multiple domains missing context.md', async () => {
      // Create multiple domains with content but no context.md
      const domain1Path = join(basePath, 'domain_one/topic')
      const domain2Path = join(basePath, 'domain_two/topic')
      const domain3Path = join(basePath, 'domain_three')

      await fs.mkdir(domain1Path, { recursive: true })
      await fs.mkdir(domain2Path, { recursive: true })
      await fs.mkdir(domain3Path, { recursive: true })

      await fs.writeFile(join(domain1Path, 'knowledge.md'), '# Knowledge 1')
      await fs.writeFile(join(domain2Path, 'knowledge.md'), '# Knowledge 2')
      // domain_three has no .md files, should be skipped

      const result = await backfillDomainContextFiles(basePath)

      expect(result).to.have.lengthOf(2)
      expect(result).to.include(join(basePath, 'domain_one/context.md'))
      expect(result).to.include(join(basePath, 'domain_two/context.md'))
    })

    it('should handle mixed scenarios (some with context.md, some without)', async () => {
      // Domain with context.md
      const withContextPath = join(basePath, 'with_context')
      await fs.mkdir(withContextPath, { recursive: true })
      await fs.writeFile(join(withContextPath, 'context.md'), '# Has context')
      await fs.mkdir(join(withContextPath, 'topic'), { recursive: true })
      await fs.writeFile(join(withContextPath, 'topic/knowledge.md'), '# Knowledge')

      // Domain without context.md
      const withoutContextPath = join(basePath, 'without_context/topic')
      await fs.mkdir(withoutContextPath, { recursive: true })
      await fs.writeFile(join(withoutContextPath, 'knowledge.md'), '# Knowledge')

      const result = await backfillDomainContextFiles(basePath)

      expect(result).to.have.lengthOf(1)
      expect(result[0]).to.equal(join(basePath, 'without_context/context.md'))
    })
  })
})
