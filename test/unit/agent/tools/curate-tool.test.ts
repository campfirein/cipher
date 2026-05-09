import {expect} from 'chai'
import * as fs from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {runWithReviewDisabled} from '../../../../src/agent/infra/tools/implementations/curate-tool-task-context.js'
import {createCurateTool, executeCurate} from '../../../../src/agent/infra/tools/implementations/curate-tool.js'

interface CurateOutput {
  applied: Array<{
    confidence?: 'high' | 'low'
    filePath?: string
    impact?: 'high' | 'low'
    message?: string
    needsReview?: boolean
    path: string
    previousSummary?: string
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

async function writeBrvConfig(tmpDir: string, reviewDisabled: boolean): Promise<void> {
  const configPath = join(tmpDir, '.brv', 'config.json')
  await fs.writeFile(
    configPath,
    JSON.stringify({createdAt: '2026-01-01T00:00:00.000Z', cwd: tmpDir, reviewDisabled, version: '0.0.1'}),
    'utf8',
  )
}

async function seedExistingFile(basePath: string): Promise<void> {
  const tool = createCurateTool()
  await tool.execute({
    basePath,
    operations: [
      {
        confidence: 'high',
        content: {keywords: [], snippets: ['initial content'], tags: []},
        impact: 'low',
        path: 'security/auth',
        reason: 'seed',
        title: 'JWT Strategy',
        type: 'ADD',
      },
    ],
  })
}

describe('Curate Tool', () => {
  let tmpDir: string
  let basePath: string

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tmpDir = join(tmpdir(), `curate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    basePath = join(tmpDir, '.brv/context-tree')
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
                confidence: 'high',
                content: {keywords: [], snippets: ['test snippet'], tags: []},
                impact: 'low',
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
                  confidence: 'high',
                  content: {keywords: [], snippets: ['test'], tags: []},
                  impact: 'low',
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
                  confidence: 'high',
                  content: {keywords: [], snippets: ['test content'], tags: []},
                  impact: 'low',
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
                confidence: 'high',
                content: {keywords: [], snippets: ['test'], tags: []},
                impact: 'low',
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
              confidence: 'high',
              content: {keywords: [], snippets: ['code style rules'], tags: []},
              impact: 'low',
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
              confidence: 'high',
              content: {keywords: [], snippets: ['test'], tags: []},
              impact: 'low',
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
              confidence: 'high',
              content: {keywords: [], snippets: ['logout content'], tags: []},
              impact: 'low',
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
              confidence: 'high',
              content: {keywords: [], snippets: ['test'], tags: []},
              impact: 'low',
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
            confidence: 'high',
            content: {keywords: [], snippets: ['test snippet'], tags: []},
            impact: 'low',
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
            confidence: 'high',
            content: {keywords: [], snippets: ['original'], tags: []},
            impact: 'low',
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
            confidence: 'high',
            content: {keywords: [], snippets: ['updated'], tags: []},
            impact: 'low',
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
            confidence: 'high',
            content: {keywords: [], snippets: ['source content'], tags: []},
            impact: 'low',
            path: 'code_style/old_topic',
            reason: 'create source',
            title: 'Old Guide',
            type: 'ADD',
          },
          {
            confidence: 'high',
            content: {keywords: [], snippets: ['target content'], tags: []},
            impact: 'low',
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
            confidence: 'high',
            impact: 'low',
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
            confidence: 'high',
            content: {keywords: [], snippets: ['updated'], tags: []},
            impact: 'low',
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
            confidence: 'high',
            content: {keywords: [], snippets: ['test'], tags: []},
            impact: 'low',
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
            confidence: 'high',
            content: {keywords: [], snippets: ['test'], tags: []},
            impact: 'low',
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
            confidence: 'high',
            content: {keywords: [], snippets: ['subtopic content'], tags: []},
            impact: 'low',
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
            confidence: 'high',
            content: {keywords: [], snippets: ['test'], tags: []},
            impact: 'low',
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
            confidence: 'high',
            impact: 'low',
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
            confidence: 'high',
            content: {keywords: [], snippets: ['test'], tags: []},
            impact: 'low',
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

  describe('Relations filtering', () => {
    it('drops derived-artifact paths (.abstract.md, .overview.md) from relations on ADD', async () => {
      const tool = createCurateTool()

      const result = (await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {
              keywords: [],
              relations: [
                'operations/cafe/sunrise_cafe_menu.md',
                'operations/cafe/sunrise_cafe_menu.abstract.md',
                'operations/cafe/sunrise_cafe_menu.overview.md',
              ],
              snippets: ['weekend brunch service'],
              tags: [],
            },
            impact: 'low',
            path: 'operations/cafe',
            reason: 'testing relations filter',
            title: 'Weekend Brunch',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')

      const writtenPath = join(basePath, 'operations/cafe/weekend_brunch.md')
      const content = await fs.readFile(writtenPath, 'utf8')
      expect(content).to.include('operations/cafe/sunrise_cafe_menu.md')
      expect(content).to.not.include('sunrise_cafe_menu.abstract.md')
      expect(content).to.not.include('sunrise_cafe_menu.overview.md')
    })

    it('strips legacy derived-artifact entries from existing related: on UPDATE (conflict-resolver path)', async () => {
      // Pre-seed a file whose related: already contains a stale .abstract.md
      // entry (legacy data from before the fix). UPDATE must not union it
      // back through resolveStructuralLoss.
      const tool = createCurateTool()
      const targetDir = join(basePath, 'operations/cafe')
      await fs.mkdir(targetDir, {recursive: true})
      const seedPath = join(targetDir, 'menu_notes.md')
      const seed = [
        '---',
        'title: Menu Notes',
        'summary: original notes',
        'tags: []',
        'related: [operations/cafe/sunrise_cafe_menu.md, operations/cafe/sunrise_cafe_menu.abstract.md]',
        'keywords: []',
        "createdAt: '2026-04-01T00:00:00.000Z'",
        "updatedAt: '2026-04-10T00:00:00.000Z'",
        '---',
        '## Reason\nseed',
        '## Raw Concept\n**Task:** seed',
      ].join('\n')
      await fs.writeFile(seedPath, seed, 'utf8')

      // Proposed retains the legitimate sibling; only the filtered abstract
      // would otherwise look "lost". With the fix, lostRelations = 0 and
      // impact stays 'low'. Without the fix, lostRelations = 1 → 'high'.
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {
              keywords: [],
              relations: ['operations/cafe/sunrise_cafe_menu.md', 'operations/cafe/ingredient_sourcing.md'],
              snippets: ['updated notes'],
              tags: [],
            },
            impact: 'low',
            path: 'operations/cafe',
            reason: 'testing UPDATE relations filter',
            title: 'Menu Notes',
            type: 'UPDATE',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      expect(result.applied[0].impact).to.equal('low')
      const written = await fs.readFile(seedPath, 'utf8')
      expect(written).to.include('operations/cafe/sunrise_cafe_menu.md')
      expect(written).to.include('operations/cafe/ingredient_sourcing.md')
      expect(written).to.not.include('sunrise_cafe_menu.abstract.md')
    })
  })

  describe('Multiple Operations', () => {
    it('should process multiple operations and return accurate summary', async () => {
      const tool = createCurateTool()

      const result = (await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {keywords: [], snippets: ['first'], tags: []},
            impact: 'low',
            path: 'code_style/topic1',
            reason: 'add 1',
            title: 'First',
            type: 'ADD',
          },
          {
            confidence: 'high',
            content: {keywords: [], snippets: ['second'], tags: []},
            impact: 'low',
            path: 'design/topic2',
            reason: 'add 2',
            title: 'Second',
            type: 'ADD',
          },
          {
            confidence: 'high',
            impact: 'low',
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
              confidence: 'high',
              content: {keywords: [], snippets: ['test content'], tags: []},
              domainContext: {
                ownership: 'Platform Security Team',
                purpose: 'Contains all knowledge related to user and service authentication mechanisms.',
                scope: {
                  excluded: ['Authorization and permission models', 'User profile management'],
                  included: ['Login and signup flows', 'Token-based authentication', 'OAuth integrations'],
                },
                usage: 'Use this domain for documenting authentication flows and identity verification.',
              },
              impact: 'low',
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

      it('should NOT create domain context.md when domainContext not provided (ENG-1059)', async () => {
        const tool = createCurateTool()

        const result = (await tool.execute({
          basePath,
          operations: [
            {
              confidence: 'high',
              content: {keywords: [], snippets: ['test content'], tags: []},
              impact: 'low',
              path: 'caching/redis',
              reason: 'testing no context creation without domainContext',
              title: 'Redis Setup',
              type: 'ADD',
            },
          ],
        })) as CurateOutput

        expect(result.applied[0].status).to.equal('success')

        // Verify domain context.md was NOT created (no static template)
        const contextMdPath = join(basePath, 'caching/context.md')
        const contextMdExists = await pathExists(contextMdPath)
        expect(contextMdExists).to.be.false

        // Verify the actual content file WAS created
        const contentFilePath = join(basePath, 'caching/redis/redis_setup.md')
        const contentFileExists = await pathExists(contentFilePath)
        expect(contentFileExists).to.be.true
      })

      it('should NOT overwrite existing domain context.md', async () => {
        const tool = createCurateTool()

        // First, create a domain with specific context
        await tool.execute({
          basePath,
          operations: [
            {
              confidence: 'high',
              content: {keywords: [], snippets: ['first content'], tags: []},
              domainContext: {
                purpose: 'Original purpose description.',
                scope: {
                  included: ['Original included item'],
                },
              },
              impact: 'low',
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
              confidence: 'high',
              content: {keywords: [], snippets: ['second content'], tags: []},
              domainContext: {
                purpose: 'This should NOT overwrite the original.',
                scope: {
                  included: ['New included item'],
                },
              },
              impact: 'low',
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
        await fs.mkdir(topicDir, {recursive: true})
        await fs.writeFile(join(topicDir, 'rest_api.md'), 'original content')

        // Now update it - should trigger context.md creation
        const result = (await tool.execute({
          basePath,
          operations: [
            {
              confidence: 'high',
              content: {keywords: [], snippets: ['updated content'], tags: []},
              domainContext: {
                purpose: 'API design patterns and guidelines.',
                scope: {
                  included: ['REST API endpoints', 'GraphQL schemas'],
                },
              },
              impact: 'low',
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
        await fs.mkdir(sourceDir, {recursive: true})
        await fs.mkdir(targetDir, {recursive: true})
        await fs.writeFile(join(sourceDir, 'source_file.md'), 'source content')
        await fs.writeFile(join(targetDir, 'target_file.md'), 'target content')

        // Perform merge
        const result = (await tool.execute({
          basePath,
          operations: [
            {
              confidence: 'high',
              domainContext: {
                purpose: 'Shared domain context for merge test.',
                scope: {
                  included: ['Merged content'],
                },
              },
              impact: 'low',
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
              confidence: 'high',
              content: {keywords: [], snippets: ['test'], tags: []},
              domainContext: {
                ownership: 'Core Infrastructure Team\nMaintained by DevOps group.',
                purpose: 'Database connection and query patterns.',
                scope: {
                  excluded: ['Application business logic', 'UI components'],
                  included: ['Connection pooling', 'Query optimization', 'Migration scripts'],
                },
                usage:
                  'Backend engineers should reference this domain when:\n- Setting up new database connections\n- Writing complex queries\n- Creating migrations',
              },
              impact: 'low',
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
              confidence: 'high',
              content: {keywords: [], snippets: ['test'], tags: []},
              domainContext: {
                purpose: 'Minimal domain with only required fields.',
                scope: {
                  included: ['Required item 1', 'Required item 2'],
                },
              },
              impact: 'low',
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
            confidence: 'high',
            content: {keywords: [], snippets: ['test'], tags: []},
            impact: 'low',
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
            confidence: 'high',
            content: {keywords: [], snippets: ['test'], tags: []},
            impact: 'low',
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
            confidence: 'high',
            impact: 'low',
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
            confidence: 'high',
            content: {keywords: [], snippets: ['test'], tags: []},
            impact: 'low',
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
            confidence: 'high',
            content: {keywords: [], snippets: ['test content'], tags: []},
            impact: 'low',
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

  describe('Conflict detection and auto-resolution (UPDATE)', () => {
    it('should auto-merge lost snippets back into the written file', async () => {
      const tool = createCurateTool()

      // Create file with two snippets
      await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {keywords: [], snippets: ['snippet-one', 'snippet-two'], tags: []},
            impact: 'low',
            path: 'auth/jwt',
            reason: 'initial',
            title: 'Token Handling',
            type: 'ADD',
          },
        ],
      })

      // Update with only one snippet (drops snippet-two)
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'low',
            content: {keywords: [], snippets: ['snippet-one'], tags: []},
            impact: 'low',
            path: 'auth/jwt',
            reason: 'update',
            title: 'Token Handling',
            type: 'UPDATE',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')

      // Verify the file still contains both snippets (auto-merge preserved snippet-two)
      const filePath = join(basePath, 'auth/jwt/token_handling.md')
      const content = await fs.readFile(filePath, 'utf8')
      expect(content).to.include('snippet-one')
      expect(content).to.include('snippet-two')
    })

    it('should elevate impact to "high" when snippets are lost', async () => {
      const tool = createCurateTool()

      // Create file with snippets
      await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {keywords: [], snippets: ['important-snippet'], tags: []},
            impact: 'low',
            path: 'auth/session',
            reason: 'initial',
            title: 'Session Flow',
            type: 'ADD',
          },
        ],
      })

      // Update without any snippets (drops important-snippet)
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {keywords: ['updated'], snippets: [], tags: []},
            impact: 'low', // LLM says low — but structural loss should elevate to high
            path: 'auth/session',
            reason: 'update',
            title: 'Session Flow',
            type: 'UPDATE',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      expect(result.applied[0].impact).to.equal('high')
    })

    it('should set needsReview=true when confidence=low and structural loss elevates impact to high', async () => {
      const tool = createCurateTool()

      // Create file with snippets
      await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {keywords: [], snippets: ['critical-info'], tags: []},
            impact: 'low',
            path: 'security/tokens',
            reason: 'initial',
            title: 'Token Policy',
            type: 'ADD',
          },
        ],
      })

      // Update: low confidence + drops snippets (structural → high impact)
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'low',
            content: {keywords: [], snippets: [], tags: []},
            impact: 'low',
            path: 'security/tokens',
            reason: 'inferred update',
            title: 'Token Policy',
            type: 'UPDATE',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      expect(result.applied[0].needsReview).to.be.true
    })

    it('should not elevate impact when no structural loss occurs', async () => {
      const tool = createCurateTool()

      // Create file with snippets
      await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {keywords: [], snippets: ['snippet-a'], tags: []},
            impact: 'low',
            path: 'config/settings',
            reason: 'initial',
            title: 'App Config',
            type: 'ADD',
          },
        ],
      })

      // Update that includes the original snippet plus more
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {keywords: [], snippets: ['snippet-a', 'snippet-b'], tags: []},
            impact: 'low',
            path: 'config/settings',
            reason: 'adding more info',
            title: 'App Config',
            type: 'UPDATE',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      expect(result.applied[0].impact).to.equal('low')
      expect(result.applied[0].needsReview).to.be.false
    })

    it('should not downgrade LLM-provided high impact', async () => {
      const tool = createCurateTool()

      await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {keywords: [], snippets: [], tags: []},
            impact: 'low',
            path: 'infra/database',
            reason: 'initial',
            title: 'DB Config',
            type: 'ADD',
          },
        ],
      })

      // LLM explicitly marks this as high impact (even though no structural loss)
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {keywords: [], snippets: [], tags: []},
            impact: 'high', // LLM says high — should remain high
            path: 'infra/database',
            reason: 'major architectural change',
            title: 'DB Config',
            type: 'UPDATE',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      expect(result.applied[0].impact).to.equal('high')
    })
  })

  describe('Folder DELETE previousSummary', () => {
    it('should populate previousSummary with bullet list of file summaries', async () => {
      const tool = createCurateTool()
      const folderPath = join(basePath, 'test_domain', 'handlers')
      await fs.mkdir(folderPath, {recursive: true})

      // Create content files with summary in frontmatter
      await fs.writeFile(
        join(folderPath, 'auth_handler.md'),
        '---\nsummary: Handles authentication requests\n---\n# Auth Handler\nContent',
      )
      await fs.writeFile(
        join(folderPath, 'status_handler.md'),
        '---\nsummary: Aggregates system status\n---\n# Status Handler\nContent',
      )
      // _index.md and context.md should be excluded from the bullet list
      await fs.writeFile(join(folderPath, '_index.md'), '---\ntype: summary\n---\n# Handlers')
      await fs.writeFile(join(folderPath, 'context.md'), '# Topic: handlers')

      const result = (await tool.execute({
        basePath,
        operations: [
          {confidence: 'high', impact: 'low', path: 'test_domain/handlers', reason: 'outdated', type: 'DELETE'},
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      expect(result.applied[0].previousSummary).to.be.a('string')
      expect(result.applied[0].previousSummary).to.include('auth handler: Handles authentication requests')
      expect(result.applied[0].previousSummary).to.include('status handler: Aggregates system status')
      expect(result.applied[0].previousSummary).to.not.include('_index')
      expect(result.applied[0].previousSummary).to.not.include('context')
    })

    it('should return no previousSummary when folder only contains _index.md and context.md', async () => {
      const tool = createCurateTool()
      const folderPath = join(basePath, 'test_domain', 'empty_topic')
      await fs.mkdir(folderPath, {recursive: true})

      await fs.writeFile(join(folderPath, '_index.md'), '---\ntype: summary\n---\n# Empty')
      await fs.writeFile(join(folderPath, 'context.md'), '# Topic: empty_topic')

      const result = (await tool.execute({
        basePath,
        operations: [
          {confidence: 'high', impact: 'low', path: 'test_domain/empty_topic', reason: 'cleanup', type: 'DELETE'},
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      expect(result.applied[0].previousSummary).to.be.undefined
    })
  })

  describe('confidence and impact defaults', () => {
    it('should accept operation without confidence (defaults to low)', async () => {
      const tool = createCurateTool()
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            content: {keywords: [], snippets: ['test snippet'], tags: []},
            impact: 'low',
            path: 'test_domain/test_topic',
            reason: 'testing confidence default',
            title: 'Test',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      expect(result.applied[0].confidence).to.equal('low')
    })

    it('should accept operation without impact (defaults to high)', async () => {
      const tool = createCurateTool()
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {keywords: [], snippets: ['test snippet'], tags: []},
            path: 'test_domain/test_topic',
            reason: 'testing impact default',
            title: 'Test',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      expect(result.applied[0].impact).to.equal('high')
      expect(result.applied[0].needsReview).to.be.true
    })

    it('should accept operation with both omitted', async () => {
      const tool = createCurateTool()
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            content: {keywords: [], snippets: ['test snippet'], tags: []},
            path: 'test_domain/test_topic',
            reason: 'testing both defaults',
            title: 'Test',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      expect(result.applied[0].confidence).to.equal('low')
      expect(result.applied[0].impact).to.equal('high')
      expect(result.applied[0].needsReview).to.be.true
    })

    it('should accept operation with both explicitly provided', async () => {
      const tool = createCurateTool()
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {keywords: [], snippets: ['test snippet'], tags: []},
            impact: 'low',
            path: 'test_domain/test_topic',
            reason: 'testing explicit values',
            title: 'Test',
            type: 'ADD',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      expect(result.applied[0].confidence).to.equal('high')
      expect(result.applied[0].impact).to.equal('low')
    })
  })

  describe('Review backup gating (`brv review --disable`)', () => {
    it('does NOT create review-backups when reviewDisabled=true (UPDATE on existing file)', async () => {
      await seedExistingFile(basePath)
      await writeBrvConfig(tmpDir, true)

      const tool = createCurateTool()
      const result = (await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {keywords: [], snippets: ['updated content'], tags: []},
            impact: 'high',
            path: 'security/auth',
            reason: 'CRITICAL update',
            title: 'JWT Strategy',
            type: 'UPDATE',
          },
        ],
      })) as CurateOutput

      expect(result.applied[0].status).to.equal('success')
      expect(result.applied[0].needsReview).to.be.true

      const backupsDir = join(tmpDir, '.brv', 'review-backups')
      expect(await pathExists(backupsDir)).to.equal(false)
    })

    it('DOES create review-backups when reviewDisabled=false (UPDATE on existing file)', async () => {
      await seedExistingFile(basePath)
      await writeBrvConfig(tmpDir, false)

      const tool = createCurateTool()
      await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {keywords: [], snippets: ['updated content'], tags: []},
            impact: 'high',
            path: 'security/auth',
            reason: 'CRITICAL update',
            title: 'JWT Strategy',
            type: 'UPDATE',
          },
        ],
      })

      const backupsDir = join(tmpDir, '.brv', 'review-backups')
      expect(await pathExists(backupsDir)).to.equal(true)
    })

    it('skips backups across MULTIPLE ops in one tool call when disabled (snapshot consistency)', async () => {
      await seedExistingFile(basePath)
      await writeBrvConfig(tmpDir, true)

      const tool = createCurateTool()
      // Three updates in a single tool invocation — all should observe the snapshot
      const result = (await tool.execute({
        basePath,
        operations: [
          {confidence: 'high', content: {keywords: [], snippets: ['v2'], tags: []}, impact: 'high', path: 'security/auth', reason: 'r', title: 'JWT Strategy', type: 'UPDATE'},
          {confidence: 'high', content: {keywords: [], snippets: ['v3'], tags: []}, impact: 'high', path: 'security/auth', reason: 'r', title: 'JWT Strategy', type: 'UPDATE'},
          {confidence: 'high', content: {keywords: [], snippets: ['v4'], tags: []}, impact: 'high', path: 'security/auth', reason: 'r', title: 'JWT Strategy', type: 'UPDATE'},
        ],
      })) as CurateOutput

      for (const op of result.applied) {
        expect(op.status).to.equal('success')
      }

      const backupsDir = join(tmpDir, '.brv', 'review-backups')
      expect(await pathExists(backupsDir)).to.equal(false)
    })

    it('treats missing config as enabled (fail-open) — backups still created', async () => {
      await seedExistingFile(basePath)
      // Note: no writeBrvConfig — .brv/config.json does not exist

      const tool = createCurateTool()
      await tool.execute({
        basePath,
        operations: [
          {
            confidence: 'high',
            content: {keywords: [], snippets: ['updated'], tags: []},
            impact: 'high',
            path: 'security/auth',
            reason: 'r',
            title: 'JWT Strategy',
            type: 'UPDATE',
          },
        ],
      })

      const backupsDir = join(tmpDir, '.brv', 'review-backups')
      expect(await pathExists(backupsDir)).to.equal(true)
    })

    it('ALS scope takes precedence over config file — scope=true suppresses backups even when config says false', async () => {
      await seedExistingFile(basePath)
      // Config says review is ENABLED
      await writeBrvConfig(tmpDir, false)

      // Scope (daemon-stamped snapshot) says DISABLED
      await runWithReviewDisabled(true, async () => {
        const tool = createCurateTool()
        await tool.execute({
          basePath,
          operations: [
            {confidence: 'high', content: {keywords: [], snippets: ['scope-test'], tags: []}, impact: 'high', path: 'security/auth', reason: 'r', title: 'JWT Strategy', type: 'UPDATE'},
          ],
        })
      })

      const backupsDir = join(tmpDir, '.brv', 'review-backups')
      expect(await pathExists(backupsDir)).to.equal(false)
    })

    it('ALS scope takes precedence over config file — scope=false enables backups even when config says true', async () => {
      await seedExistingFile(basePath)
      // Config says review is DISABLED
      await writeBrvConfig(tmpDir, true)

      // Scope says ENABLED
      await runWithReviewDisabled(false, async () => {
        const tool = createCurateTool()
        await tool.execute({
          basePath,
          operations: [
            {confidence: 'high', content: {keywords: [], snippets: ['scope-test-2'], tags: []}, impact: 'high', path: 'security/auth', reason: 'r', title: 'JWT Strategy', type: 'UPDATE'},
          ],
        })
      })

      const backupsDir = join(tmpDir, '.brv', 'review-backups')
      expect(await pathExists(backupsDir)).to.equal(true)
    })

    it('ALS scope honored via executeCurate sandbox path (no _context.taskId) — proves CurateService route picks up the snapshot', async () => {
      // This is the regression that the Map-based registry missed: CurateService.curate()
      // calls executeCurate(input, undefined, ...). Without ALS the file read wins on toggle.
      await seedExistingFile(basePath)
      // File config says DISABLED — what the CLI would see after a mid-task `brv review --disable`
      await writeBrvConfig(tmpDir, true)

      // Scope captured the snapshot at task-create (review was ENABLED then)
      await runWithReviewDisabled(false, async () => {
        // Mimic CurateService.curate(): executeCurate with _context = undefined
        await executeCurate({
          basePath,
          operations: [
            {confidence: 'high', content: {keywords: [], snippets: ['als-via-sandbox'], tags: []}, impact: 'high', path: 'security/auth', reason: 'r', title: 'JWT Strategy', type: 'UPDATE'},
          ],
        })
      })

      const backupsDir = join(tmpDir, '.brv', 'review-backups')
      expect(await pathExists(backupsDir)).to.equal(true)
    })

    it('outside any ALS scope falls back to config file', async () => {
      await seedExistingFile(basePath)
      await writeBrvConfig(tmpDir, true)

      // No runWithReviewDisabled wrapper → ALS returns undefined → fallback reads config = disabled
      await executeCurate({
        basePath,
        operations: [
          {confidence: 'high', content: {keywords: [], snippets: ['no-scope'], tags: []}, impact: 'high', path: 'security/auth', reason: 'r', title: 'JWT Strategy', type: 'UPDATE'},
        ],
      })

      const backupsDir = join(tmpDir, '.brv', 'review-backups')
      expect(await pathExists(backupsDir)).to.equal(false)
    })
  })
})
