import {expect} from 'chai'
import * as fs from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ICipherAgent} from '../../../src/agent/core/interfaces/i-cipher-agent.js'
import type {IFileSystem} from '../../../src/agent/core/interfaces/i-file-system.js'
import type {IRuntimeSignalStore} from '../../../src/server/core/interfaces/storage/i-runtime-signal-store.js'

import {createCurateTool} from '../../../src/agent/infra/tools/implementations/curate-tool.js'
import {SearchKnowledgeService} from '../../../src/agent/infra/tools/implementations/search-knowledge-service.js'
import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../src/server/constants.js'
import {createDefaultRuntimeSignals} from '../../../src/server/core/domain/knowledge/runtime-signals-schema.js'
import {FileContextTreeArchiveService} from '../../../src/server/infra/context-tree/file-context-tree-archive-service.js'
import {createMockRuntimeSignalStore} from '../../helpers/mock-factories.js'

interface PendingAccessHitsInternals {
  pendingAccessHits: Map<string, number>
}

function createDiskFileSystem(): IFileSystem {
  return {
    async readFile(path: string) {
      return {content: await fs.readFile(path, 'utf8')}
    },
    async writeFile(path: string, content: string) {
      await fs.writeFile(path, content, 'utf8')
    },
  } as unknown as IFileSystem
}

function createMockAgent(): ICipherAgent {
  return {
    async cancel() {},
    async createTaskSession() {
      return 'mock-session'
    },
    async deleteSandboxVariable() {},
    async deleteSandboxVariableOnSession() {},
    async deleteSession() {},
    async deleteTaskSession() {},
    async execute() {
      return 'ghost cue'
    },
    async executeOnSession() {
      return 'ghost cue'
    },
    async generate() {
      return 'ghost cue'
    },
    async getSessionMetadata() {},
    getState() {
      return 'idle'
    },
    async listPersistedSessions() {
      return []
    },
    async reset() {},
    async setSandboxVariable() {},
    async setSandboxVariableOnSession() {},
    async start() {},
    async *stream() {
      yield 'ghost cue'
    },
  } as unknown as ICipherAgent
}

/**
 * End-to-end integration test for commit 3 (runtime-signals dual-write).
 *
 * Exercises the full sequence — curate ADD, curate UPDATE, flushAccessHits,
 * curate MERGE, archive — on the same project tree, with a shared
 * RuntimeSignalStore. Asserts the sidecar reflects the expected end state
 * at each stage and stays consistent with markdown where observable.
 */
describe('Runtime-signals dual-write pipeline', () => {
  let projectRoot: string
  let contextTreeDir: string
  let signalStore: IRuntimeSignalStore
  let curateTool: {execute(input: unknown): Promise<unknown>}
  let searchService: SearchKnowledgeService
  let archiveService: FileContextTreeArchiveService
  let agent: ICipherAgent

  beforeEach(async () => {
    projectRoot = join(tmpdir(), `rs-pipeline-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    contextTreeDir = join(projectRoot, BRV_DIR, CONTEXT_TREE_DIR)
    await fs.mkdir(contextTreeDir, {recursive: true})

    signalStore = createMockRuntimeSignalStore()
    curateTool = createCurateTool(undefined, undefined, signalStore) as {execute(input: unknown): Promise<unknown>}
    searchService = new SearchKnowledgeService(createDiskFileSystem(), {runtimeSignalStore: signalStore})
    archiveService = new FileContextTreeArchiveService(signalStore)
    agent = createMockAgent()
  })

  afterEach(async () => {
    await fs.rm(projectRoot, {force: true, recursive: true})
  })

  it('ADD → UPDATE → flushAccessHits → MERGE → archive leaves the sidecar in the expected end state', async () => {
    // Step 1: ADD two files.
    await curateTool.execute({
      basePath: contextTreeDir,
      operations: [
        {
          confidence: 'high',
          content: {snippets: ['source content'], tags: ['auth']},
          impact: 'low',
          path: 'auth/jwt',
          reason: 'seed',
          title: 'Refresh',
          type: 'ADD',
        },
        {
          confidence: 'high',
          content: {snippets: ['target content'], tags: ['auth']},
          impact: 'low',
          path: 'auth/jwt',
          reason: 'seed',
          title: 'Rotation',
          type: 'ADD',
        },
      ],
    })

    const srcRel = 'auth/jwt/refresh.md'
    const tgtRel = 'auth/jwt/rotation.md'

    // Both files have default signals.
    expect(await signalStore.get(srcRel)).to.deep.equal(createDefaultRuntimeSignals())
    expect(await signalStore.get(tgtRel)).to.deep.equal(createDefaultRuntimeSignals())

    // Step 2: UPDATE the target — bumps importance +5, updateCount +1.
    await curateTool.execute({
      basePath: contextTreeDir,
      operations: [
        {
          confidence: 'high',
          content: {snippets: ['updated'], tags: ['auth']},
          impact: 'low',
          path: 'auth/jwt',
          reason: 'refine',
          title: 'Rotation',
          type: 'UPDATE',
        },
      ],
    })

    const afterUpdate = await signalStore.get(tgtRel)
    expect(afterUpdate.importance).to.equal(55)
    expect(afterUpdate.updateCount).to.equal(1)
    expect(afterUpdate.recency).to.equal(1)
    expect(afterUpdate.maturity).to.equal('draft')

    // Step 3: flushAccessHits on both files.
    ;(searchService as unknown as PendingAccessHitsInternals).pendingAccessHits.set(srcRel, 3)
    ;(searchService as unknown as PendingAccessHitsInternals).pendingAccessHits.set(tgtRel, 4)
    await searchService.flushAccessHits(contextTreeDir)

    const srcAfterFlush = await signalStore.get(srcRel)
    // Source: default(50) + 3*3 = 59
    expect(srcAfterFlush.importance).to.equal(59)
    expect(srcAfterFlush.accessCount).to.equal(3)
    expect(srcAfterFlush.maturity).to.equal('draft') // 59 < 65

    const tgtAfterFlush = await signalStore.get(tgtRel)
    // Target: 55 (from UPDATE) + 3*4 = 67 → crosses PROMOTE_TO_VALIDATED (65)
    expect(tgtAfterFlush.importance).to.equal(67)
    expect(tgtAfterFlush.accessCount).to.equal(4)
    expect(tgtAfterFlush.maturity).to.equal('validated')

    // Step 4: MERGE source into target. Merged signals land on target;
    // source entry is dropped.
    await curateTool.execute({
      basePath: contextTreeDir,
      operations: [
        {
          confidence: 'high',
          impact: 'low',
          mergeTarget: 'auth/jwt',
          mergeTargetTitle: 'Rotation',
          path: 'auth/jwt',
          reason: 'consolidate',
          title: 'Refresh',
          type: 'MERGE',
        },
      ],
    })

    // Source sidecar entry gone.
    expect((await signalStore.list()).has(srcRel)).to.equal(false)

    // Target merged: max importance = max(59, 67) = 67; accessCount sum = 3+4 = 7;
    // updateCount = 1 + 0 + 1 = 2; maturity re-derived at 67 = validated.
    const afterMerge = await signalStore.get(tgtRel)
    expect(afterMerge.importance).to.equal(67)
    expect(afterMerge.accessCount).to.equal(7)
    expect(afterMerge.updateCount).to.equal(2)
    expect(afterMerge.maturity).to.equal('validated')

    // Step 5: Archive the merged target.
    await archiveService.archiveEntry(tgtRel, agent, projectRoot)

    // Sidecar entry for the archived path is gone.
    expect((await signalStore.list()).has(tgtRel)).to.equal(false)
    // No orphans remain for either path.
    expect((await signalStore.list()).size).to.equal(0)
  })
})
