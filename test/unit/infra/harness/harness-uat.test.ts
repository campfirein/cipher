/**
 * AutoHarness Phase 1 — UAT Integration Tests
 *
 * These tests exercise the full harness pipeline end-to-end:
 * - File-based persistence (real filesystem, not mocks)
 * - Template selection (Thompson sampling)
 * - Shadow mode F1 scoring
 * - Fast path activation after stat accumulation
 * - Feedback recording (success/failure/shadow/execution-failure)
 * - Concurrency safety (per-node locks, no lost updates)
 * - Refinement cycle (critic → refiner → child creation)
 * - Fail-open behavior (harness errors never block curation)
 * - Post-mutation vs pre-mutation error semantics
 */

import {expect} from 'chai'
import {readFileSync} from 'node:fs'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import sinon from 'sinon'

import type {HarnessNode} from '../../../../src/server/core/interfaces/harness/i-harness-tree-store.js'

import {createCurationHarness} from '../../../../src/server/infra/harness/curation/create-curation-harness.js'
import {buildTemplatePrompt, buildTemplateStreamOptions, TEMPLATE_MAX_ITERATIONS} from '../../../../src/server/infra/harness/curation/curation-template-executor.js'
import {FileHarnessTreeStore} from '../../../../src/server/infra/harness/file-harness-tree-store.js'
import {HarnessEngine} from '../../../../src/server/infra/harness/harness-engine.js'

function createMockContentGenerator() {
  return {
    estimateTokensSync: sinon.stub().returns(100),
    generateContent: sinon.stub().resolves({
      content: 'domainRouting:\n  - keywords: [auth, jwt, oauth]\n    domain: security/authentication\n  - keywords: [deploy, ci, cd, pipeline]\n    domain: infrastructure/deployment',
      finishReason: 'stop',
      toolCalls: [],
      usage: {inputTokens: 0, outputTokens: 0, totalTokens: 0},
    }),
    generateContentStream: sinon.stub(),
  }
}

describe('AutoHarness Phase 1 — UAT', () => {
  let testDir: string
  let sandbox: sinon.SinonSandbox

  beforeEach(async () => {
    testDir = join(tmpdir(), `brv-harness-uat-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
    sandbox = sinon.createSandbox()
  })

  afterEach(async () => {
    sandbox.restore()
    await rm(testDir, {force: true, recursive: true})
  })

  // ─── UAT 1.1: Fresh project, first curate ─────────────────────────
  describe('Scenario 1.1: Fresh project initialization', () => {
    it('should seed root template on first createCurationHarness call', async () => {
      const service = await createCurationHarness(testDir)
      expect(service).to.not.be.null

      // Verify harness directory structure
      const treePath = join(testDir, 'harness', 'curation', '_tree.json')
      const treeRaw = readFileSync(treePath, 'utf8')
      const tree = JSON.parse(treeRaw)

      expect(tree.version).to.equal(1)
      expect(tree.nodes).to.have.length(1)
      expect(tree.nodes[0].parentId).to.be.null // root node
      expect(tree.nodes[0].metadata.seeded).to.be.true
      expect(tree.nodes[0].visitCount).to.equal(0) // no curates yet
      expect(tree.nodes[0].heuristic).to.equal(0.5) // default alpha/(alpha+beta) = 1/2
    })

    it('should select shadow mode on first curate (heuristic < 0.9)', async () => {
      const service = await createCurationHarness(testDir)
      const selection = await service!.selectTemplate()

      expect(selection).to.not.be.null
      expect(selection!.mode).to.equal('shadow') // heuristic 0.5 < 0.9
    })

    it('should not re-seed if root already exists', async () => {
      const service1 = await createCurationHarness(testDir)
      const selection1 = await service1!.selectTemplate()
      const firstNodeId = selection1!.node.id

      // Create again — should reuse existing root
      const service2 = await createCurationHarness(testDir)
      const selection2 = await service2!.selectTemplate()

      expect(selection2!.node.id).to.equal(firstNodeId)
    })
  })

  // ─── UAT 1.3: No harness = no change ──────────────────────────────
  describe('Scenario 1.3: Fail-open on init failure', () => {
    it('should return null when storage path is invalid', async () => {
      // Use a file (not directory) as the storage path — mkdir will fail
      const invalidPath = join(testDir, 'not-a-dir')
      // Write a file at that path so mkdir fails
      const {writeFileSync} = await import('node:fs')
      writeFileSync(invalidPath, 'blocker')

      const service = await createCurationHarness(invalidPath)
      // Fail-open: returns null, doesn't throw
      expect(service).to.be.null
    })
  })

  // ─── UAT 2.1-2.3: Shadow mode behavior ────────────────────────────
  describe('Scenario 2: Shadow mode feedback', () => {
    it('should record F1-scored feedback without altering curation behavior', async () => {
      const service = await createCurationHarness(testDir)
      const selection = await service!.selectTemplate()
      expect(selection!.mode).to.equal('shadow')

      // Simulate shadow: template predicts security/authentication (keywords: auth, jwt)
      // Actual curate operation went to security/authentication — perfect match
      await service!.recordShadowFeedback(
        selection!.node,
        'content about auth and jwt tokens for login',
        [{path: 'security/authentication', status: 'success', type: 'ADD'}],
      )

      // Check stats updated
      const store = new FileHarnessTreeStore({getBaseDir: () => testDir})
      const node = await store.getNode('curation', selection!.node.id)

      expect(node!.visitCount).to.equal(1)
      // Perfect match: alpha should have increased (F1 ≈ 1)
      expect(node!.alpha).to.be.greaterThan(1)
    })

    it('should record zero-ops as neutral signal (UAT 2.3)', async () => {
      const service = await createCurationHarness(testDir)
      const selection = await service!.selectTemplate()

      // Empty actuals — no signal
      await service!.recordShadowFeedback(
        selection!.node,
        'trivial content',
        [],
      )

      const store = new FileHarnessTreeStore({getBaseDir: () => testDir})
      const node = await store.getNode('curation', selection!.node.id)
      expect(node!.visitCount).to.equal(0) // no update (neutral)
    })
  })

  // ─── UAT 3: Fast path activation ──────────────────────────────────
  describe('Scenario 3: Fast path activation after stat accumulation', () => {
    it('should transition from shadow to fast mode as heuristic rises above 0.9', async () => {
      const store = new FileHarnessTreeStore({getBaseDir: () => testDir})
      const service = await createCurationHarness(testDir)
      const initial = await service!.selectTemplate()
      expect(initial!.mode).to.equal('shadow')

      // Simulate many successful curates — build up alpha
      // Each recordFeedback with successes increments alpha by 1
      for (let i = 0; i < 20; i++) {
        // eslint-disable-next-line no-await-in-loop
        await service!.recordFeedback(initial!.node.id, [
          {path: `topic/${i}`, status: 'success', type: 'ADD'},
        ])
      }

      const node = await store.getNode('curation', initial!.node.id)
      // alpha = 1 + 20 = 21, beta = 1 → heuristic = 21/22 ≈ 0.954
      expect(node!.heuristic).to.be.greaterThan(0.9)

      // Now selection should return fast mode
      // Need a new service instance to see the updated stats
      const service2 = await createCurationHarness(testDir)
      const selection = await service2!.selectTemplate()
      expect(selection!.mode).to.equal('fast')
    })

    it('should build template prompt with reduced iterations (10 vs 50)', () => {
      const templateNode: HarnessNode = {
        alpha: 18,
        beta: 1,
        childIds: [],
        createdAt: Date.now(),
        heuristic: 0.95,
        id: 'fast-node',
        metadata: {},
        parentId: null,
        templateContent: 'domainRouting:\n  - keywords: [auth]\n    domain: security/authentication',
        visitCount: 10,
      }

      const prompt = buildTemplatePrompt(templateNode, 'Base curation prompt here')
      const options = buildTemplateStreamOptions('session-1', 'task-1')

      // Template prepended
      expect(prompt).to.include('## Curation Strategy (learned)')
      expect(prompt).to.include('domainRouting:')
      expect(prompt).to.include('Base curation prompt here')

      // Reduced iterations
      expect(options.executionContext!.maxIterations).to.equal(TEMPLATE_MAX_ITERATIONS)
      expect(TEMPLATE_MAX_ITERATIONS).to.equal(10)
    })
  })

  // ─── UAT 4: Fast path error handling ───────────────────────────────
  describe('Scenario 4: Feedback recording semantics', () => {
    it('should record positive feedback on success (UAT 3.4)', async () => {
      const service = await createCurationHarness(testDir)
      const selection = await service!.selectTemplate()

      await service!.recordFeedback(selection!.node.id, [
        {path: 'architecture/api/endpoints', status: 'success', type: 'ADD'},
      ])

      const store = new FileHarnessTreeStore({getBaseDir: () => testDir})
      const node = await store.getNode('curation', selection!.node.id)
      expect(node!.alpha).to.equal(2) // 1 + 1 success
      expect(node!.beta).to.equal(1) // unchanged
    })

    it('should record negative feedback on execution failure', async () => {
      const service = await createCurationHarness(testDir)
      const selection = await service!.selectTemplate()

      await service!.recordExecutionFailure(
        selection!.node.id,
        [{path: 'partial/result', status: 'success', type: 'ADD'}],
        'timeout',
      )

      const store = new FileHarnessTreeStore({getBaseDir: () => testDir})
      const node = await store.getNode('curation', selection!.node.id)
      expect(node!.alpha).to.equal(1) // unchanged (failure)
      expect(node!.beta).to.equal(2) // 1 + 1 failure
    })

    it('should penalize template on failure with mixed ops', async () => {
      const service = await createCurationHarness(testDir)
      const selection = await service!.selectTemplate()

      // Even with some successful ops, execution failure = failure
      await service!.recordExecutionFailure(
        selection!.node.id,
        [
          {path: 'a/b', status: 'success', type: 'ADD'},
          {path: 'c/d', status: 'failed', type: 'ADD'},
        ],
        'error',
      )

      const store = new FileHarnessTreeStore({getBaseDir: () => testDir})
      const node = await store.getNode('curation', selection!.node.id)
      expect(node!.beta).to.equal(2) // always failure
    })
  })

  // ─── UAT 5: Feedback persistence ──────────────────────────────────
  describe('Scenario 5: Feedback persistence', () => {
    it('should persist stats to disk after each feedback (UAT 5.1)', async () => {
      const service = await createCurationHarness(testDir)
      const selection = await service!.selectTemplate()

      await service!.recordFeedback(selection!.node.id, [
        {path: 'test/path', status: 'success', type: 'ADD'},
      ])

      // Read directly from disk (not from in-memory cache)
      const treePath = join(testDir, 'harness', 'curation', '_tree.json')
      const tree = JSON.parse(readFileSync(treePath, 'utf8'))
      expect(tree.nodes[0].alpha).to.equal(2) // persisted
      expect(tree.nodes[0].visitCount).to.equal(1) // persisted
    })

    it('should accumulate stats across 5 curates (UAT 5.4)', async () => {
      const service = await createCurationHarness(testDir)
      const selection = await service!.selectTemplate()

      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await service!.recordFeedback(selection!.node.id, [
          {path: `topic/${i}`, status: 'success', type: 'ADD'},
        ])
      }

      const store = new FileHarnessTreeStore({getBaseDir: () => testDir})
      const node = await store.getNode('curation', selection!.node.id)
      expect(node!.alpha).to.equal(6) // 1 + 5
      expect(node!.beta).to.equal(1)
      expect(node!.visitCount).to.equal(5)
    })

    it('should survive tree file re-read after crash (UAT 5.3)', async () => {
      const service = await createCurationHarness(testDir)
      const selection = await service!.selectTemplate()

      await service!.recordFeedback(selection!.node.id, [
        {path: 'test', status: 'success', type: 'ADD'},
      ])

      // Simulate crash: create a brand new store from the same dir
      const freshStore = new FileHarnessTreeStore({getBaseDir: () => testDir})
      const node = await freshStore.getNode('curation', selection!.node.id)

      expect(node).to.not.be.null
      expect(node!.alpha).to.equal(2)
      expect(node!.templateContent).to.include('domainRouting')
    })
  })

  // ─── UAT 6: Concurrency safety ────────────────────────────────────
  describe('Scenario 6: Concurrency safety', () => {
    it('should serialize concurrent feedback for same node (UAT 6.1)', async () => {
      const service = await createCurationHarness(testDir)
      const selection = await service!.selectTemplate()

      // Fire 10 concurrent recordFeedback calls
      const promises = Array.from({length: 10}, (_, i) =>
        service!.recordFeedback(selection!.node.id, [
          {path: `concurrent/${i}`, status: 'success', type: 'ADD'},
        ]),
      )
      await Promise.all(promises)

      const store = new FileHarnessTreeStore({getBaseDir: () => testDir})
      const node = await store.getNode('curation', selection!.node.id)
      // All 10 should be applied: alpha = 1 + 10 = 11
      expect(node!.alpha).to.equal(11)
      expect(node!.visitCount).to.equal(10)
    })

    it('should handle mixed concurrent success/failure (UAT 6.1)', async () => {
      const service = await createCurationHarness(testDir)
      const selection = await service!.selectTemplate()

      // 5 successes + 5 failures concurrently
      const promises = [
        ...Array.from({length: 5}, (_, i) =>
          service!.recordFeedback(selection!.node.id, [
            {path: `success/${i}`, status: 'success', type: 'ADD'},
          ]),
        ),
        ...Array.from({length: 5}, (_, i) =>
          service!.recordFeedback(selection!.node.id, [
            {path: `fail/${i}`, status: 'failed', type: 'ADD'},
          ]),
        ),
      ]
      await Promise.all(promises)

      const store = new FileHarnessTreeStore({getBaseDir: () => testDir})
      const node = await store.getNode('curation', selection!.node.id)
      // alpha = 1 + 5 = 6, beta = 1 + 5 = 6
      expect(node!.alpha).to.equal(6)
      expect(node!.beta).to.equal(6)
      expect(node!.visitCount).to.equal(10)
    })
  })

  // ─── UAT 8: Known limitations ─────────────────────────────────────
  describe('Scenario 8: Known limitations', () => {
    it('should skip refinement when no content generator is set (UAT 8.1)', async () => {
      const service = await createCurationHarness(testDir)
      const selection = await service!.selectTemplate()

      // Record failures to trigger refinement
      for (let i = 0; i < 10; i++) {
        // eslint-disable-next-line no-await-in-loop
        await service!.recordFeedback(selection!.node.id, [
          {path: `fail/${i}`, status: 'failed', type: 'ADD'},
        ])
      }

      // No setContentGenerator() called → refinement returns null
      const result = await service!.refineIfNeeded(selection!.node.id)
      expect(result).to.be.null

      // No children created
      const store = new FileHarnessTreeStore({getBaseDir: () => testDir})
      const node = await store.getNode('curation', selection!.node.id)
      expect(node!.childIds).to.have.length(0)
    })

    it('should handle truncated/empty tool output as neutral (UAT 8.2)', async () => {
      const service = await createCurationHarness(testDir)
      const selection = await service!.selectTemplate()

      // Empty operations (simulates truncated output)
      await service!.recordFeedback(selection!.node.id, [])

      const store = new FileHarnessTreeStore({getBaseDir: () => testDir})
      const node = await store.getNode('curation', selection!.node.id)
      expect(node!.visitCount).to.equal(0) // neutral, no update
    })
  })

  // ─── UAT 9: File persistence & storage ─────────────────────────────
  describe('Scenario 9: File persistence structure', () => {
    it('should create correct directory structure (UAT 9.1)', async () => {
      await createCurationHarness(testDir)

      const {readdirSync} = await import('node:fs')
      const harnessDir = join(testDir, 'harness', 'curation')
      const files = readdirSync(harnessDir)

      expect(files).to.include('_tree.json')
      // Should have exactly one .md file (root template)
      const mdFiles = files.filter((f: string) => f.endsWith('.md'))
      expect(mdFiles).to.have.length(1)
    })

    it('should pass Zod validation on tree file (UAT 9.3)', async () => {
      await createCurationHarness(testDir)

      const treePath = join(testDir, 'harness', 'curation', '_tree.json')
      const tree = JSON.parse(readFileSync(treePath, 'utf8'))

      // Required fields check
      expect(tree).to.have.property('version', 1)
      expect(tree).to.have.property('nodes')
      expect(tree.nodes).to.be.an('array')

      for (const node of tree.nodes) {
        expect(node).to.have.property('id')
        expect(node).to.have.property('alpha')
        expect(node).to.have.property('beta')
        expect(node).to.have.property('heuristic')
        expect(node).to.have.property('visitCount')
        expect(node).to.have.property('childIds')
        expect(node).to.have.property('createdAt')
        expect(node).to.have.property('metadata')
        // parentId can be null for root
        expect(node).to.have.property('parentId')
      }
    })

    it('should recover from corrupt .md file (UAT 9.4)', async () => {
      const service = await createCurationHarness(testDir)
      const selection = await service!.selectTemplate()
      const nodeId = selection!.node.id

      // Delete the template .md file
      const {unlinkSync} = await import('node:fs')
      const templatePath = join(testDir, 'harness', 'curation', `${nodeId}.md`)
      unlinkSync(templatePath)

      // New store should filter out the orphaned node
      const freshStore = new FileHarnessTreeStore({getBaseDir: () => testDir})
      const node = await freshStore.getNode('curation', nodeId)
      expect(node).to.be.null

      const allNodes = await freshStore.getAllNodes('curation')
      expect(allNodes).to.have.length(0)
    })
  })

  // ─── UAT 10: Edge cases ───────────────────────────────────────────
  describe('Scenario 10: Edge cases', () => {
    it('should handle non-existent node feedback gracefully (UAT 10.1)', async () => {
      const service = await createCurationHarness(testDir)

      // Should not throw
      await service!.recordFeedback('nonexistent-node', [
        {path: 'test', status: 'success', type: 'ADD'},
      ])
    })

    it('should handle concurrent init + feedback without corruption', async () => {
      const service = await createCurationHarness(testDir)
      const selection = await service!.selectTemplate()

      // Init a second service from same dir while first is recording feedback
      const [, service2] = await Promise.all([
        service!.recordFeedback(selection!.node.id, [
          {path: 'a', status: 'success', type: 'ADD'},
        ]),
        createCurationHarness(testDir),
      ])

      // Both should see valid state
      const sel2 = await service2!.selectTemplate()
      expect(sel2).to.not.be.null
      expect(sel2!.node.id).to.equal(selection!.node.id) // same root
    })
  })

  // ─── Refinement cycle (with mock LLM) ─────────────────────────────
  describe('Refinement cycle with LLM', () => {
    it('should create refined child when failures trigger refinement', async () => {
      const store = new FileHarnessTreeStore({getBaseDir: () => testDir})
      const mockGen = createMockContentGenerator()
      // Critic returns summary
      mockGen.generateContent.onFirstCall().resolves({
        content: 'The template routes auth correctly but misses deployment paths.',
        finishReason: 'stop',
        toolCalls: [],
        usage: {inputTokens: 0, outputTokens: 0, totalTokens: 0},
      })
      // Refiner returns improved YAML
      mockGen.generateContent.onSecondCall().resolves({
        content: 'domainRouting:\n  - keywords: [auth, jwt, oauth, login]\n    domain: security/authentication\n  - keywords: [deploy, ci, cd, pipeline, docker, kubernetes, argocd]\n    domain: infrastructure/deployment',
        finishReason: 'stop',
        toolCalls: [],
        usage: {inputTokens: 0, outputTokens: 0, totalTokens: 0},
      })

      const engine = new HarnessEngine({
        config: {domain: 'curation', refinementCooldown: 2},
        contentGenerator: mockGen,
        treeStore: store,
      })
      // Seed root
      const harness = await createCurationHarness(testDir)
      const selection = await harness!.selectTemplate()

      // Record failures to accumulate in engine's buffer
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await engine.recordOutcome({
          details: {mode: 'fast'},
          nodeId: selection!.node.id,
          success: false,
          timestamp: Date.now(),
        })
      }

      // Run refinement cycle
      const child = await engine.runRefinementCycle(selection!.node.id)

      expect(child).to.not.be.null
      expect(child!.parentId).to.equal(selection!.node.id)
      expect(child!.templateContent).to.include('argocd') // refined content
      expect(child!.visitCount).to.equal(0)
      expect(child!.alpha).to.equal(1) // fresh priors
      expect(child!.beta).to.equal(1)

      // Parent should reference child
      const parent = await store.getNode('curation', selection!.node.id)
      expect(parent!.childIds).to.include(child!.id)

      // Child template file should exist on disk
      const childTemplatePath = join(testDir, 'harness', 'curation', `${child!.id}.md`)
      const childContent = readFileSync(childTemplatePath, 'utf8')
      expect(childContent).to.include('argocd')
    })

    it('should prevent concurrent refinement for the same node', async () => {
      const store = new FileHarnessTreeStore({getBaseDir: () => testDir})
      const mockGen = createMockContentGenerator()

      // First call blocks until we resolve it
      let resolveFirst: (value: unknown) => void
      const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve
      })
      mockGen.generateContent.onFirstCall().returns(firstPromise)

      const engine = new HarnessEngine({
        config: {domain: 'curation', refinementCooldown: 1},
        contentGenerator: mockGen,
        treeStore: store,
      })

      // Seed root
      await createCurationHarness(testDir)
      const selection = await engine.selectTemplate()

      // Record failures
      await engine.recordOutcome({
        details: {},
        nodeId: selection!.node.id,
        success: false,
        timestamp: Date.now(),
      })
      await engine.recordOutcome({
        details: {},
        nodeId: selection!.node.id,
        success: false,
        timestamp: Date.now(),
      })

      // Start first refinement (blocks on LLM)
      const first = engine.runRefinementCycle(selection!.node.id)
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })

      // Second refinement should be immediately skipped
      const second = await engine.runRefinementCycle(selection!.node.id)
      expect(second).to.be.null

      // Clean up
      resolveFirst!({content: 'critic result', finishReason: 'stop', toolCalls: [], usage: {inputTokens: 0, outputTokens: 0, totalTokens: 0}})
      await first.catch(() => {}) // may fail since buffer was consumed
    })
  })
})
