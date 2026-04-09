/**
 * QueryExecutor tests
 *
 * 1. Variable naming regression: UUID hyphens in sandbox variable names cause
 *    ReferenceError when LLM writes code using underscores.
 *
 * 2. Workspace scoping (PR3): search scope derivation, scope injection for
 *    agent follow-up searches, and cache fingerprint isolation.
 */

import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, stub} from 'sinon'

import type {ICipherAgent} from '../../../../src/agent/core/interfaces/i-cipher-agent.js'
import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'
import type {ISearchKnowledgeService} from '../../../../src/agent/infra/sandbox/tools-sdk.js'

import {LocalSandbox} from '../../../../src/agent/infra/sandbox/local-sandbox.js'
import {QueryExecutor} from '../../../../src/server/infra/executor/query-executor.js'

function createMockAgent(): ICipherAgent {
  return {
    cancel: stub().resolves(false),
    createTaskSession: stub().resolves('session-1'),
    deleteSandboxVariable: stub(),
    deleteSandboxVariableOnSession: stub(),
    deleteSession: stub().resolves(true),
    deleteTaskSession: stub().resolves(),
    execute: stub().resolves(''),
    executeOnSession: stub().resolves('response text'),
    generate: stub().resolves({content: '', toolCalls: [], usage: {inputTokens: 0, outputTokens: 0}}),
    getSessionMetadata: stub().resolves(),
    getState: stub().returns({currentIteration: 0, executionHistory: [], executionState: 'idle', toolCallsExecuted: 0}),
    listPersistedSessions: stub().resolves([]),
    reset: stub(),
    setSandboxVariable: stub(),
    setSandboxVariableOnSession: stub(),
    setupTaskForwarding: stub().returns(() => {}),
    start: stub().resolves(),
    stream: stub().resolves({[Symbol.asyncIterator]: () => ({next: () => Promise.resolve({done: true, value: undefined})})}),
  } as unknown as ICipherAgent
}

// Low-score results: enough to avoid OOD short-circuit, but below direct-response threshold
// so the executor falls through to the LLM path (createTaskSession + executeOnSession).
// totalFound >= 3 avoids supplementary entity searches (which would call search multiple times).
const lowScoreSearchResult = {
  message: '',
  results: [
    {excerpt: 'test A', path: 'a.md', score: 0.3, title: 'A'},
    {excerpt: 'test B', path: 'b.md', score: 0.2, title: 'B'},
    {excerpt: 'test C', path: 'c.md', score: 0.1, title: 'C'},
  ],
  totalFound: 3,
}

describe('QueryExecutor', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-query-executor-')))
  })

  afterEach(() => {
    restore()
    rmSync(tempDir, {force: true, recursive: true})
  })

  describe('sandbox variable naming (regression)', () => {
    const taskId = '8cd8e2d8-a7fc-4371-89ca-59460687c12d'
    const llmGeneratedResultsVar = '__query_results_8cd8e2d8_a7fc_4371_89ca_59460687c12d'
    const llmGeneratedMetaVar = '__query_meta_8cd8e2d8_a7fc_4371_89ca_59460687c12d'

    describe('bug: hyphenated taskId causes variable name mismatch', () => {
      it('should fail with ReferenceError when __query_results_* stored with hyphens', async () => {
        const sandbox = new LocalSandbox()

        const buggyResultsVar = `__query_results_${taskId}`
        sandbox.updateContext({[buggyResultsVar]: [{path: '/a.md', score: 0.9}]})

        const result = await sandbox.execute(llmGeneratedResultsVar)

        expect(result.stderr).to.include('ReferenceError')
        expect(result.stderr).to.include(llmGeneratedResultsVar)
      })

      it('should fail with ReferenceError when __query_meta_* stored with hyphens', async () => {
        const sandbox = new LocalSandbox()

        const buggyMetaVar = `__query_meta_${taskId}`
        sandbox.updateContext({[buggyMetaVar]: {resultCount: 3, topScore: 0.9, totalFound: 10}})

        const result = await sandbox.execute(`${llmGeneratedMetaVar}.resultCount`)

        expect(result.stderr).to.include('ReferenceError')
      })
    })

    describe('fix: taskIdSafe with underscores eliminates mismatch', () => {
      it('should succeed when __query_results_* stored with underscores matching LLM output', async () => {
        const sandbox = new LocalSandbox()

        const taskIdSafe = taskId.replaceAll('-', '_')
        const fixedResultsVar = `__query_results_${taskIdSafe}`
        sandbox.updateContext({[fixedResultsVar]: [{path: '/a.md', score: 0.9}]})

        const result = await sandbox.execute(`${llmGeneratedResultsVar}[0].score`)

        expect(result.stderr).to.equal('')
        expect(result.returnValue).to.equal(0.9)
      })

      it('should succeed when __query_meta_* stored with underscores matching LLM output', async () => {
        const sandbox = new LocalSandbox()

        const taskIdSafe = taskId.replaceAll('-', '_')
        const fixedMetaVar = `__query_meta_${taskIdSafe}`
        sandbox.updateContext({[fixedMetaVar]: {resultCount: 3, topScore: 0.9, totalFound: 10}})

        const result = await sandbox.execute(`${llmGeneratedMetaVar}.resultCount`)

        expect(result.stderr).to.equal('')
        expect(result.returnValue).to.equal(3)
      })

      it('should correctly transform all UUID segments (4 hyphens replaced)', () => {
        const taskIdSafe = taskId.replaceAll('-', '_')

        expect(taskIdSafe).to.not.include('-')
        expect(taskIdSafe).to.equal('8cd8e2d8_a7fc_4371_89ca_59460687c12d')

        expect(`__query_results_${taskIdSafe}`).to.equal(llmGeneratedResultsVar)
        expect(`__query_meta_${taskIdSafe}`).to.equal(llmGeneratedMetaVar)
      })
    })
  })

  describe('workspace scoping (PR3)', () => {
    describe('search scope derivation', () => {
      it('should pass workspace scope to initial search when worktreeRoot differs from baseDirectory', async () => {
        const searchStub = stub().resolves(lowScoreSearchResult)
        const searchService: ISearchKnowledgeService = {search: searchStub}

        const executor = new QueryExecutor({
          baseDirectory: '/projects/monorepo',
          searchService,
        })

        const agent = createMockAgent()
        await executor.executeWithAgent(agent, {
          query: 'authentication',
          taskId: 'task-1',
          worktreeRoot: '/projects/monorepo/packages/api',
        })

        expect(searchStub.called).to.be.true
        const searchOpts = searchStub.firstCall.args[1]
        expect(searchOpts.scope).to.equal('packages/api')
      })

      it('should not pass scope when worktreeRoot equals baseDirectory', async () => {
        const searchStub = stub().resolves(lowScoreSearchResult)
        const searchService: ISearchKnowledgeService = {search: searchStub}

        const executor = new QueryExecutor({
          baseDirectory: '/projects/myapp',
          searchService,
        })

        const agent = createMockAgent()
        await executor.executeWithAgent(agent, {
          query: 'authentication',
          taskId: 'task-2',
          worktreeRoot: '/projects/myapp',
        })

        expect(searchStub.called).to.be.true
        const searchOpts = searchStub.firstCall.args[1]
        expect(searchOpts.scope).to.be.undefined
      })

      it('should not pass scope when worktreeRoot is undefined', async () => {
        const searchStub = stub().resolves(lowScoreSearchResult)
        const searchService: ISearchKnowledgeService = {search: searchStub}

        const executor = new QueryExecutor({
          baseDirectory: '/projects/myapp',
          searchService,
        })

        const agent = createMockAgent()
        await executor.executeWithAgent(agent, {
          query: 'authentication',
          taskId: 'task-3',
        })

        expect(searchStub.called).to.be.true
        const searchOpts = searchStub.firstCall.args[1]
        expect(searchOpts.scope).to.be.undefined
      })
    })

    describe('workspace scope injection for agent follow-up searches', () => {
      it('should inject scope variable into sandbox when worktreeRoot differs from baseDirectory', async () => {
        const searchStub = stub().resolves(lowScoreSearchResult)
        const searchService: ISearchKnowledgeService = {search: searchStub}

        const executor = new QueryExecutor({
          baseDirectory: '/projects/monorepo',
          searchService,
        })

        const agent = createMockAgent()
        await executor.executeWithAgent(agent, {
          query: 'authentication',
          taskId: 'abc-def',
          worktreeRoot: '/projects/monorepo/packages/api',
        })

        const setSandboxCalls = (agent.setSandboxVariableOnSession as ReturnType<typeof stub>).getCalls()
        const scopeCall = setSandboxCalls.find((c: {args: unknown[]}) => (c.args[1] as string).startsWith('__query_scope_'))
        expect(scopeCall).to.not.be.undefined
        expect(scopeCall!.args[2]).to.equal('packages/api')
      })

      it('should not inject scope variable when worktreeRoot equals baseDirectory', async () => {
        const searchStub = stub().resolves(lowScoreSearchResult)
        const searchService: ISearchKnowledgeService = {search: searchStub}

        const executor = new QueryExecutor({
          baseDirectory: '/projects/myapp',
          searchService,
        })

        const agent = createMockAgent()
        await executor.executeWithAgent(agent, {
          query: 'authentication',
          taskId: 'abc-def',
          worktreeRoot: '/projects/myapp',
        })

        const setSandboxCalls = (agent.setSandboxVariableOnSession as ReturnType<typeof stub>).getCalls()
        const scopeCall = setSandboxCalls.find((c: {args: unknown[]}) => (c.args[1] as string).startsWith('__query_scope_'))
        expect(scopeCall).to.be.undefined
      })

      it('should include scope guidance in prompt when workspace scope is active', async () => {
        const searchStub = stub().resolves(lowScoreSearchResult)
        const searchService: ISearchKnowledgeService = {search: searchStub}

        const executor = new QueryExecutor({
          baseDirectory: '/projects/monorepo',
          searchService,
        })

        const agent = createMockAgent()
        await executor.executeWithAgent(agent, {
          query: 'authentication',
          taskId: 'abc-def',
          worktreeRoot: '/projects/monorepo/packages/api',
        })

        const executeCall = (agent.executeOnSession as ReturnType<typeof stub>).firstCall
        const prompt = executeCall.args[1] as string
        expect(prompt).to.include('tools.searchKnowledge()')
        expect(prompt).to.include('scope')
        expect(prompt).to.include('__query_scope_')
      })
    })

    describe('cache fingerprint isolation', () => {
      it('should produce different fingerprints for different worktreeRoot values', async () => {
        const globStub = stub().resolves({
          files: [{modified: new Date('2026-01-01'), path: 'a.md'}],
          totalMatches: 1,
        })
        const fileSystem = {globFiles: globStub, readFile: stub()} as unknown as IFileSystem
        const searchStub = stub().resolves(lowScoreSearchResult)

        const executor = new QueryExecutor({
          baseDirectory: '/projects/monorepo',
          enableCache: true,
          fileSystem,
          searchService: {search: searchStub},
        })

        const agent = createMockAgent()

        await executor.executeWithAgent(agent, {
          query: 'authentication',
          taskId: 'task-a',
          worktreeRoot: '/projects/monorepo/packages/api',
        })

        await executor.executeWithAgent(agent, {
          query: 'authentication',
          taskId: 'task-b',
          worktreeRoot: '/projects/monorepo/packages/web',
        })

        // Both should have gone through full execution (executeOnSession called twice)
        expect((agent.executeOnSession as ReturnType<typeof stub>).callCount).to.equal(2)
      })

      it('should invalidate cached responses when linked knowledge changes', async () => {
        const projectRoot = join(tempDir, 'project-a')
        const linkedProjectRoot = join(tempDir, 'project-b')
        mkdirSync(join(projectRoot, '.brv', 'context-tree'), {recursive: true})
        mkdirSync(join(linkedProjectRoot, '.brv', 'context-tree'), {recursive: true})
        writeFileSync(join(projectRoot, '.brv', 'config.json'), JSON.stringify({version: '0.0.1'}))
        writeFileSync(join(linkedProjectRoot, '.brv', 'config.json'), JSON.stringify({version: '0.0.1'}))
        writeFileSync(
          join(projectRoot, '.brv', 'sources.json'),
          JSON.stringify({
            sources: [{addedAt: '2026-01-01', alias: 'shared-lib', projectRoot: linkedProjectRoot, readOnly: true}],
            version: 1,
          }),
        )

        let linkedMtime = new Date('2026-01-01')
        const fileSystem = {
          globFiles: stub().callsFake(async (_pattern: string, options?: {cwd?: string}) => {
            if (options?.cwd === join('.brv', 'context-tree')) {
              return {files: [{modified: new Date('2026-01-01'), path: 'local.md'}], totalMatches: 1}
            }

            if (options?.cwd === join(linkedProjectRoot, '.brv', 'context-tree')) {
              return {files: [{modified: linkedMtime, path: 'shared.md'}], totalMatches: 1}
            }

            return {files: [], totalMatches: 0}
          }),
          readFile: stub(),
        } as unknown as IFileSystem

        const executor = new QueryExecutor({
          baseDirectory: projectRoot,
          enableCache: true,
          fileSystem,
          searchService: {search: stub().resolves(lowScoreSearchResult)},
        })

        const agent = createMockAgent()

        await executor.executeWithAgent(agent, {
          query: 'authentication',
          taskId: 'task-a',
          worktreeRoot: projectRoot,
        })

        linkedMtime = new Date('2026-01-02')
        ;(executor as unknown as {cachedFingerprint?: unknown}).cachedFingerprint = undefined

        await executor.executeWithAgent(agent, {
          query: 'authentication',
          taskId: 'task-b',
          worktreeRoot: projectRoot,
        })

        expect((agent.executeOnSession as ReturnType<typeof stub>).callCount).to.equal(2)
      })

      it('should auto-invalidate fingerprint cache when knowledge link target is deleted within TTL', async () => {
        const projectRoot = join(tempDir, 'project-c')
        const linkedProjectRoot = join(tempDir, 'project-d')
        mkdirSync(join(projectRoot, '.brv', 'context-tree'), {recursive: true})
        mkdirSync(join(linkedProjectRoot, '.brv', 'context-tree'), {recursive: true})
        writeFileSync(join(projectRoot, '.brv', 'config.json'), JSON.stringify({version: '0.0.1'}))
        writeFileSync(join(linkedProjectRoot, '.brv', 'config.json'), JSON.stringify({version: '0.0.1'}))
        writeFileSync(
          join(projectRoot, '.brv', 'sources.json'),
          JSON.stringify({
            sources: [{addedAt: '2026-01-01', alias: 'shared', projectRoot: linkedProjectRoot, readOnly: true}],
            version: 1,
          }),
        )

        const fileSystem = {
          globFiles: stub().callsFake(async (_pattern: string, options?: {cwd?: string}) => {
            if (options?.cwd === join('.brv', 'context-tree')) {
              return {files: [{modified: new Date('2026-01-01'), path: 'local.md'}], totalMatches: 1}
            }

            if (options?.cwd === join(linkedProjectRoot, '.brv', 'context-tree')) {
              return {files: [{modified: new Date('2026-01-01'), path: 'shared.md'}], totalMatches: 1}
            }

            return {files: [], totalMatches: 0}
          }),
          readFile: stub(),
        } as unknown as IFileSystem

        const executor = new QueryExecutor({
          baseDirectory: projectRoot,
          enableCache: true,
          fileSystem,
          searchService: {search: stub().resolves(lowScoreSearchResult)},
        })

        const agent = createMockAgent()

        // First query — populates fingerprint cache
        await executor.executeWithAgent(agent, {
          query: 'authentication',
          taskId: 'task-c',
          worktreeRoot: projectRoot,
        })

        // Break the link target — delete its config (within TTL window)
        // Do NOT manually clear cachedFingerprint — the source validity check should detect this
        rmSync(join(linkedProjectRoot, '.brv', 'config.json'))

        // Same query — should miss cache because source validity hash changed
        await executor.executeWithAgent(agent, {
          query: 'authentication',
          taskId: 'task-d',
          worktreeRoot: projectRoot,
        })

        // Both queries should have gone through full execution (no stale cache hit)
        expect((agent.executeOnSession as ReturnType<typeof stub>).callCount).to.equal(2)
      })
    })
  })
})
