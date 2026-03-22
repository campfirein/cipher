import {expect} from 'chai'
import sinon from 'sinon'

import type {HarnessNode, IHarnessTreeStore} from '../../../../src/server/core/interfaces/harness/i-harness-tree-store.js'

import {HarnessEngine} from '../../../../src/server/infra/harness/harness-engine.js'

function createNode(overrides: Partial<HarnessNode> = {}): HarnessNode {
  return {
    alpha: 1,
    beta: 1,
    childIds: [],
    createdAt: Date.now(),
    heuristic: 0.5,
    id: `node-${Math.random().toString(36).slice(2)}`,
    metadata: {},
    parentId: null,
    templateContent: 'test: true',
    visitCount: 0,
    ...overrides,
  }
}

function createMockTreeStore(): IHarnessTreeStore & {nodes: Map<string, HarnessNode>} {
  const nodes = new Map<string, HarnessNode>()

  return {
    async deleteNode(_domain: string, nodeId: string) {
      nodes.delete(nodeId)
    },

    async getAllNodes(_domain: string) {
      return [...nodes.values()]
    },

    async getNode(_domain: string, nodeId: string) {
      return nodes.get(nodeId) ?? null
    },

    async getRootNode(_domain: string) {
      return [...nodes.values()].find((n) => n.parentId === null) ?? null
    },

    nodes,

    async saveNode(_domain: string, node: HarnessNode) {
      nodes.set(node.id, node)
    },
  }
}

function createMockContentGenerator() {
  return {
    estimateTokensSync: sinon.stub().returns(100),
    generateContent: sinon.stub().resolves({content: 'improved: true', finishReason: 'stop', toolCalls: [], usage: {inputTokens: 0, outputTokens: 0, totalTokens: 0}}),
    generateContentStream: sinon.stub(),
  }
}

describe('HarnessEngine', () => {
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('selectTemplate', () => {
    it('should return null for empty domain', async () => {
      const treeStore = createMockTreeStore()
      const engine = new HarnessEngine({
        config: {domain: 'curation'},
        contentGenerator: createMockContentGenerator(),
        treeStore,
      })

      const result = await engine.selectTemplate()
      expect(result).to.be.null
    })

    it('should select a node and determine mode', async () => {
      const treeStore = createMockTreeStore()
      const node = createNode({heuristic: 0.95, id: 'high-perf'})
      treeStore.nodes.set('high-perf', node)

      const engine = new HarnessEngine({
        config: {domain: 'curation'},
        contentGenerator: createMockContentGenerator(),
        treeStore,
      })

      const result = await engine.selectTemplate()
      expect(result).to.not.be.null
      expect(result!.node.id).to.equal('high-perf')
      expect(result!.mode).to.equal('fast')
    })

    it('should return shadow mode for low-heuristic node', async () => {
      const treeStore = createMockTreeStore()
      const node = createNode({heuristic: 0.3, id: 'low-perf'})
      treeStore.nodes.set('low-perf', node)

      const engine = new HarnessEngine({
        config: {domain: 'curation'},
        contentGenerator: createMockContentGenerator(),
        treeStore,
      })

      const result = await engine.selectTemplate()
      expect(result).to.not.be.null
      expect(result!.mode).to.equal('shadow')
    })
  })

  describe('recordOutcome', () => {
    it('should update node alpha on success', async () => {
      const treeStore = createMockTreeStore()
      const node = createNode({alpha: 5, beta: 3, id: 'test-node'})
      treeStore.nodes.set('test-node', node)

      const engine = new HarnessEngine({
        config: {domain: 'curation'},
        contentGenerator: createMockContentGenerator(),
        treeStore,
      })

      await engine.recordOutcome({
        details: {},
        nodeId: 'test-node',
        success: true,
        timestamp: Date.now(),
      })

      const updated = treeStore.nodes.get('test-node')!
      expect(updated.alpha).to.equal(6)
      expect(updated.beta).to.equal(3)
      expect(updated.visitCount).to.equal(1)
    })

    it('should update node beta on failure', async () => {
      const treeStore = createMockTreeStore()
      const node = createNode({alpha: 5, beta: 3, id: 'test-node'})
      treeStore.nodes.set('test-node', node)

      const engine = new HarnessEngine({
        config: {domain: 'curation'},
        contentGenerator: createMockContentGenerator(),
        treeStore,
      })

      await engine.recordOutcome({
        details: {},
        nodeId: 'test-node',
        success: false,
        timestamp: Date.now(),
      })

      const updated = treeStore.nodes.get('test-node')!
      expect(updated.alpha).to.equal(5)
      expect(updated.beta).to.equal(4)
    })

    it('should no-op for non-existent node', async () => {
      const treeStore = createMockTreeStore()
      const engine = new HarnessEngine({
        config: {domain: 'curation'},
        contentGenerator: createMockContentGenerator(),
        treeStore,
      })

      // Should not throw
      await engine.recordOutcome({
        details: {},
        nodeId: 'nonexistent',
        success: true,
        timestamp: Date.now(),
      })
    })
  })

  describe('shouldRefine', () => {
    it('should return false when below cooldown', () => {
      const engine = new HarnessEngine({
        config: {domain: 'curation', refinementCooldown: 5},
        contentGenerator: createMockContentGenerator(),
        treeStore: createMockTreeStore(),
      })

      expect(engine.shouldRefine('curation', 'n1')).to.be.false
    })

    it('should return false when no recent failures', async () => {
      const treeStore = createMockTreeStore()
      const node = createNode({id: 'n1'})
      treeStore.nodes.set('n1', node)

      const engine = new HarnessEngine({
        config: {domain: 'curation', refinementCooldown: 1},
        contentGenerator: createMockContentGenerator(),
        treeStore,
      })

      // Record enough successes to pass cooldown (non-shadow, non-failure)
      await engine.recordOutcome({details: {}, nodeId: 'n1', success: true, timestamp: Date.now()})
      await engine.recordOutcome({details: {}, nodeId: 'n1', success: true, timestamp: Date.now()})
      await engine.recordOutcome({details: {}, nodeId: 'n1', success: true, timestamp: Date.now()})

      expect(engine.shouldRefine('curation', 'n1')).to.be.false
    })

    it('should return true when cooldown passed and failures exist', async () => {
      const treeStore = createMockTreeStore()
      const node = createNode({id: 'n1'})
      treeStore.nodes.set('n1', node)

      const engine = new HarnessEngine({
        config: {domain: 'curation', refinementCooldown: 1},
        contentGenerator: createMockContentGenerator(),
        treeStore,
      })

      // Record a failure
      await engine.recordOutcome({
        details: {},
        nodeId: 'n1',
        success: false,
        timestamp: Date.now(),
      })

      // Record another to pass cooldown
      await engine.recordOutcome({
        details: {},
        nodeId: 'n1',
        success: false,
        timestamp: Date.now(),
      })

      expect(engine.shouldRefine('curation', 'n1')).to.be.true
    })

    it('should not refine on perfect shadow matches alone', async () => {
      const treeStore = createMockTreeStore()
      const node = createNode({id: 'n1'})
      treeStore.nodes.set('n1', node)

      const engine = new HarnessEngine({
        config: {domain: 'curation', refinementCooldown: 1},
        contentGenerator: createMockContentGenerator(),
        treeStore,
      })

      await engine.recordOutcomeF1('n1', 1, 0, {
        details: {f1Score: 1, mode: 'shadow'},
        nodeId: 'n1',
        success: true,
        timestamp: Date.now(),
      })

      expect(engine.shouldRefine('curation', 'n1')).to.be.false
    })

    it('should refine on imperfect shadow matches after cooldown', async () => {
      const treeStore = createMockTreeStore()
      const node = createNode({id: 'n1'})
      treeStore.nodes.set('n1', node)

      const engine = new HarnessEngine({
        config: {domain: 'curation', refinementCooldown: 1},
        contentGenerator: createMockContentGenerator(),
        treeStore,
      })

      await engine.recordOutcomeF1('n1', 0.75, 0.25, {
        details: {f1Score: 0.75, mode: 'shadow'},
        nodeId: 'n1',
        success: true,
        timestamp: Date.now(),
      })

      expect(engine.shouldRefine('curation', 'n1')).to.be.true
    })
  })

  describe('refine', () => {
    it('should create a child node with refined template', async () => {
      const treeStore = createMockTreeStore()
      const parent = createNode({id: 'parent', templateContent: 'original: true'})
      treeStore.nodes.set('parent', parent)

      const mockGenerator = createMockContentGenerator()
      mockGenerator.generateContent.resolves({content: 'improved: true', finishReason: 'stop'})

      const engine = new HarnessEngine({
        config: {domain: 'curation'},
        contentGenerator: mockGenerator,
        treeStore,
      })

      const child = await engine.refine('parent', 'Domain routing is too broad')

      expect(child).to.not.be.null
      expect(child.parentId).to.equal('parent')
      expect(child.templateContent).to.equal('improved: true')
      expect(child.visitCount).to.equal(0)

      // Parent should have child in childIds
      const updatedParent = treeStore.nodes.get('parent')!
      expect(updatedParent.childIds).to.include(child.id)
    })

    it('should throw for non-existent parent', async () => {
      const engine = new HarnessEngine({
        config: {domain: 'curation'},
        contentGenerator: createMockContentGenerator(),
        treeStore: createMockTreeStore(),
      })

      try {
        await engine.refine('nonexistent', 'test')
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('not found')
      }
    })

    it('should prune worst child when maxChildren exceeded', async () => {
      const treeStore = createMockTreeStore()
      const parent = createNode({childIds: ['c1', 'c2'], id: 'parent'})
      const child1 = createNode({heuristic: 0.3, id: 'c1', parentId: 'parent'})
      const child2 = createNode({heuristic: 0.8, id: 'c2', parentId: 'parent'})

      treeStore.nodes.set('parent', parent)
      treeStore.nodes.set('c1', child1)
      treeStore.nodes.set('c2', child2)

      const engine = new HarnessEngine({
        config: {domain: 'curation', maxChildren: 2},
        contentGenerator: createMockContentGenerator(),
        treeStore,
      })

      await engine.refine('parent', 'test refinement')

      // c1 (worst performer) should be pruned
      expect(treeStore.nodes.has('c1')).to.be.false
      // c2 should still exist
      expect(treeStore.nodes.has('c2')).to.be.true
      // New child should exist
      const updatedParent = treeStore.nodes.get('parent')!
      expect(updatedParent.childIds).to.have.length(2)
      expect(updatedParent.childIds).to.include('c2')
    })
  })

  describe('recordOutcomeF1', () => {
    it('should apply fractional alpha/beta from F1 score', async () => {
      const treeStore = createMockTreeStore()
      const node = createNode({alpha: 5, beta: 3, id: 'f1-node'})
      treeStore.nodes.set('f1-node', node)

      const engine = new HarnessEngine({
        config: {domain: 'curation'},
        contentGenerator: createMockContentGenerator(),
        treeStore,
      })

      await engine.recordOutcomeF1('f1-node', 0.75, 0.25, {
        details: {f1Score: 0.75, mode: 'shadow'},
        nodeId: 'f1-node',
        success: true,
        timestamp: Date.now(),
      })

      const updated = treeStore.nodes.get('f1-node')!
      expect(updated.alpha).to.be.closeTo(5.75, 0.001)
      expect(updated.beta).to.be.closeTo(3.25, 0.001)
      expect(updated.visitCount).to.equal(1)
    })

    it('should no-op for non-existent node', async () => {
      const engine = new HarnessEngine({
        config: {domain: 'curation'},
        contentGenerator: createMockContentGenerator(),
        treeStore: createMockTreeStore(),
      })

      // Should not throw
      await engine.recordOutcomeF1('nonexistent', 0.5, 0.5, {
        details: {},
        nodeId: 'nonexistent',
        success: true,
        timestamp: Date.now(),
      })
    })
  })

  describe('concurrency', () => {
    it('should serialize concurrent outcome recordings for the same node', async () => {
      const treeStore = createMockTreeStore()
      const node = createNode({alpha: 1, beta: 1, id: 'concurrent-node'})
      treeStore.nodes.set('concurrent-node', node)

      const engine = new HarnessEngine({
        config: {domain: 'curation'},
        contentGenerator: createMockContentGenerator(),
        treeStore,
      })

      // Fire 10 concurrent updates
      const promises = Array.from({length: 10}, (_, i) =>
        engine.recordOutcome({
          details: {index: i},
          nodeId: 'concurrent-node',
          success: true,
          timestamp: Date.now(),
        }),
      )
      await Promise.all(promises)

      const updated = treeStore.nodes.get('concurrent-node')!
      // All 10 should be applied: alpha = 1 + 10 = 11
      expect(updated.alpha).to.equal(11)
      expect(updated.beta).to.equal(1)
      expect(updated.visitCount).to.equal(10)
    })

    it('should allow parallel updates to different nodes', async () => {
      const treeStore = createMockTreeStore()
      const node1 = createNode({alpha: 1, beta: 1, id: 'node-a'})
      const node2 = createNode({alpha: 1, beta: 1, id: 'node-b'})
      treeStore.nodes.set('node-a', node1)
      treeStore.nodes.set('node-b', node2)

      const engine = new HarnessEngine({
        config: {domain: 'curation'},
        contentGenerator: createMockContentGenerator(),
        treeStore,
      })

      await Promise.all([
        engine.recordOutcome({details: {}, nodeId: 'node-a', success: true, timestamp: Date.now()}),
        engine.recordOutcome({details: {}, nodeId: 'node-b', success: false, timestamp: Date.now()}),
      ])

      expect(treeStore.nodes.get('node-a')!.alpha).to.equal(2) // +1 success
      expect(treeStore.nodes.get('node-b')!.beta).to.equal(2) // +1 failure
    })

    it('should prevent duplicate refinement cycles for the same node', async () => {
      const treeStore = createMockTreeStore()
      const parent = createNode({id: 'dup-parent', templateContent: 'original: true'})
      treeStore.nodes.set('dup-parent', parent)

      const mockGenerator = createMockContentGenerator()
      // First call to generateContent is slow (simulates LLM latency)
      let resolveFirst: (value: unknown) => void
      const firstCallPromise = new Promise((resolve) => {
        resolveFirst = resolve
      })
      mockGenerator.generateContent.onFirstCall().returns(firstCallPromise)
      mockGenerator.generateContent.onSecondCall().resolves({content: 'improved: true', finishReason: 'stop'})

      const engine = new HarnessEngine({
        config: {domain: 'curation', refinementCooldown: 1},
        contentGenerator: mockGenerator,
        treeStore,
      })

      // Record failure to enable refinement
      await engine.recordOutcome({
        details: {},
        nodeId: 'dup-parent',
        success: false,
        timestamp: Date.now(),
      })

      // Start first refinement (will block on LLM call)
      const first = engine.runRefinementCycle('dup-parent')
      // Wait for the first call to actually enter the refinement guard
      await new Promise<void>((resolve) => { setTimeout(resolve, 0) })

      // Second refinement should be skipped (returns null immediately)
      const second = await engine.runRefinementCycle('dup-parent')
      expect(second).to.be.null

      // Resolve first call to clean up
      resolveFirst!({content: 'critic summary', finishReason: 'stop'})
      await first
    })
  })

  describe('runRefinementCycle', () => {
    it('should clear consumed feedback after a successful refinement', async () => {
      const treeStore = createMockTreeStore()
      const parent = createNode({id: 'parent', templateContent: 'original: true'})
      treeStore.nodes.set('parent', parent)

      const mockGenerator = createMockContentGenerator()
      mockGenerator.generateContent.resolves({content: 'improved: true', finishReason: 'stop'})

      const engine = new HarnessEngine({
        config: {domain: 'curation', refinementCooldown: 1},
        contentGenerator: mockGenerator,
        treeStore,
      })

      await engine.recordOutcome({
        details: {},
        nodeId: 'parent',
        success: false,
        timestamp: Date.now(),
      })

      const child = await engine.runRefinementCycle('parent')
      expect(child).to.not.be.null

      await engine.recordOutcome({
        details: {},
        nodeId: 'parent',
        success: true,
        timestamp: Date.now(),
      })

      expect(engine.shouldRefine('curation', 'parent')).to.be.false
    })

    it('should preserve feedback recorded while refinement is in flight', async () => {
      const treeStore = createMockTreeStore()
      const parent = createNode({id: 'parent', templateContent: 'original: true'})
      treeStore.nodes.set('parent', parent)

      const mockGenerator = createMockContentGenerator()
      mockGenerator.generateContent.onFirstCall().callsFake(async () => {
        await engine.recordOutcome({
          details: {late: true},
          nodeId: 'parent',
          success: false,
          timestamp: Date.now() + 1,
        })

        return {content: 'critic summary', finishReason: 'stop'}
      })
      mockGenerator.generateContent.onSecondCall().resolves({content: 'improved: true', finishReason: 'stop'})

      const engine = new HarnessEngine({
        config: {domain: 'curation', refinementCooldown: 1},
        contentGenerator: mockGenerator,
        treeStore,
      })

      await engine.recordOutcome({
        details: {initial: true},
        nodeId: 'parent',
        success: false,
        timestamp: Date.now(),
      })

      const child = await engine.runRefinementCycle('parent')
      expect(child).to.not.be.null
      expect(engine.shouldRefine('curation', 'parent')).to.be.true
    })
  })
})
