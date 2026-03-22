import {expect} from 'chai'
import sinon from 'sinon'

import type {HarnessNode, IHarnessTreeStore} from '../../../../../src/server/core/interfaces/harness/i-harness-tree-store.js'

import {CurationHarnessService} from '../../../../../src/server/infra/harness/curation/curation-harness-service.js'
import {HarnessEngine} from '../../../../../src/server/infra/harness/harness-engine.js'

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
    templateContent: 'domainRouting:\n  - keywords: [auth]\n    domain: security/authentication',
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

function createService(treeStore?: IHarnessTreeStore & {nodes: Map<string, HarnessNode>}) {
  const store = treeStore ?? createMockTreeStore()
  const engine = new HarnessEngine({
    config: {domain: 'curation', refinementCooldown: 2},
    contentGenerator: createMockContentGenerator(),
    treeStore: store,
  })

  return {engine, service: new CurationHarnessService(engine), store}
}

describe('CurationHarnessService', () => {
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('selectTemplate', () => {
    it('should return null for empty tree', async () => {
      const {service} = createService()
      const result = await service.selectTemplate()

      expect(result).to.be.null
    })

    it('should return fast mode for high-heuristic node', async () => {
      const store = createMockTreeStore()
      const node = createNode({heuristic: 0.95, id: 'high-node'})
      store.nodes.set('high-node', node)

      const {service} = createService(store)
      const result = await service.selectTemplate()

      expect(result).to.not.be.null
      expect(result!.mode).to.equal('fast')
      expect(result!.node.id).to.equal('high-node')
    })

    it('should return shadow mode for low-heuristic node', async () => {
      const store = createMockTreeStore()
      const node = createNode({heuristic: 0.3, id: 'low-node'})
      store.nodes.set('low-node', node)

      const {service} = createService(store)
      const result = await service.selectTemplate()

      expect(result).to.not.be.null
      expect(result!.mode).to.equal('shadow')
    })
  })

  describe('recordFeedback', () => {
    it('should update alpha on all-success operations', async () => {
      const store = createMockTreeStore()
      const node = createNode({alpha: 5, beta: 3, id: 'fb-node'})
      store.nodes.set('fb-node', node)

      const {service} = createService(store)
      await service.recordFeedback('fb-node', [
        {path: 'a/b.md', status: 'success', type: 'ADD'},
        {path: 'c/d.md', status: 'success', type: 'UPDATE'},
      ])

      const updated = store.nodes.get('fb-node')!
      expect(updated.alpha).to.equal(6) // +1 for success
      expect(updated.beta).to.equal(3) // unchanged
    })

    it('should update beta on any-failure operations', async () => {
      const store = createMockTreeStore()
      const node = createNode({alpha: 5, beta: 3, id: 'fb-node'})
      store.nodes.set('fb-node', node)

      const {service} = createService(store)
      await service.recordFeedback('fb-node', [
        {path: 'a/b.md', status: 'success', type: 'ADD'},
        {path: 'c/d.md', status: 'failed', type: 'ADD'},
      ])

      const updated = store.nodes.get('fb-node')!
      expect(updated.alpha).to.equal(5) // unchanged (failure)
      expect(updated.beta).to.equal(4) // +1 for failure
    })

    it('should no-op for empty operations (neutral signal)', async () => {
      const store = createMockTreeStore()
      const node = createNode({alpha: 5, beta: 3, id: 'fb-node', visitCount: 0})
      store.nodes.set('fb-node', node)

      const {service} = createService(store)
      await service.recordFeedback('fb-node', [])

      const updated = store.nodes.get('fb-node')!
      expect(updated.alpha).to.equal(5) // unchanged
      expect(updated.beta).to.equal(3) // unchanged
      expect(updated.visitCount).to.equal(0) // no visit recorded
    })
  })

  describe('recordExecutionFailure', () => {
    it('should always record as failure regardless of operation outcomes', async () => {
      const store = createMockTreeStore()
      const node = createNode({alpha: 5, beta: 3, id: 'fail-node'})
      store.nodes.set('fail-node', node)

      const {service} = createService(store)
      // Even with "success" operations, execution failure means template failed
      await service.recordExecutionFailure('fail-node', [
        {path: 'a/b.md', status: 'success', type: 'ADD'},
      ], 'timeout')

      const updated = store.nodes.get('fail-node')!
      expect(updated.alpha).to.equal(5) // unchanged (failure)
      expect(updated.beta).to.equal(4) // +1 for failure
    })

    it('should handle empty operations gracefully', async () => {
      const store = createMockTreeStore()
      const node = createNode({alpha: 5, beta: 3, id: 'fail-node'})
      store.nodes.set('fail-node', node)

      const {service} = createService(store)
      await service.recordExecutionFailure('fail-node', [], 'error')

      const updated = store.nodes.get('fail-node')!
      expect(updated.beta).to.equal(4) // +1 for failure
    })

    it('should include terminalReason in feedback details', async () => {
      const store = createMockTreeStore()
      const node = createNode({id: 'detail-node'})
      store.nodes.set('detail-node', node)

      const {engine, service} = createService(store)
      const recordSpy = sandbox.spy(engine, 'recordOutcome')

      await service.recordExecutionFailure('detail-node', [], 'max-iterations')

      expect(recordSpy.calledOnce).to.be.true
      expect(recordSpy.firstCall.args[0].details.terminalReason).to.equal('max-iterations')
      expect(recordSpy.firstCall.args[0].success).to.be.false
    })
  })

  describe('recordShadowFeedback', () => {
    it('should use F1-score for fractional alpha/beta updates', async () => {
      const store = createMockTreeStore()
      const templateContent = 'domainRouting:\n  - keywords: [auth]\n    domain: security/authentication'
      const node = createNode({alpha: 5, beta: 3, id: 'shadow-node', templateContent})
      store.nodes.set('shadow-node', node)

      const {service} = createService(store)
      // Template predicts security/authentication; actuals include it
      await service.recordShadowFeedback(
        node,
        'content about auth and jwt tokens',
        [{path: 'security/authentication', status: 'success', type: 'ADD'}],
      )

      const updated = store.nodes.get('shadow-node')!
      // Perfect match: alpha should increase by ~1, beta by ~0
      expect(updated.alpha).to.be.greaterThan(5)
      expect(updated.visitCount).to.equal(1)
    })

    it('should penalize imperfect predictions', async () => {
      const store = createMockTreeStore()
      const templateContent = 'domainRouting:\n  - keywords: [auth]\n    domain: security/authentication'
      const node = createNode({alpha: 5, beta: 3, id: 'shadow-node', templateContent})
      store.nodes.set('shadow-node', node)

      const {service} = createService(store)
      // Template predicts security/authentication but actual is something else
      await service.recordShadowFeedback(
        node,
        'content about auth and jwt tokens',
        [{path: 'infrastructure/deployment', status: 'success', type: 'ADD'}],
      )

      const updated = store.nodes.get('shadow-node')!
      // Complete miss: alpha gets 0, beta gets 1
      expect(updated.beta).to.be.greaterThan(3)
    })

    it('should no-op when no successful actuals', async () => {
      const store = createMockTreeStore()
      const node = createNode({alpha: 5, beta: 3, id: 'shadow-node', visitCount: 0})
      store.nodes.set('shadow-node', node)

      const {service} = createService(store)
      await service.recordShadowFeedback(
        node,
        'auth content',
        [{path: 'security/auth', status: 'failed', type: 'ADD'}],
      )

      const updated = store.nodes.get('shadow-node')!
      expect(updated.alpha).to.equal(5) // unchanged
      expect(updated.visitCount).to.equal(0) // no visit
    })

    it('should no-op when context does not match any template keywords', async () => {
      const store = createMockTreeStore()
      const templateContent = 'domainRouting:\n  - keywords: [auth]\n    domain: security/authentication'
      const node = createNode({alpha: 5, beta: 3, id: 'shadow-node', templateContent, visitCount: 0})
      store.nodes.set('shadow-node', node)

      const {service} = createService(store)
      // "deploy" doesn't match "auth" keywords
      await service.recordShadowFeedback(
        node,
        'content about deploying kubernetes pods',
        [{path: 'infrastructure/deployment', status: 'success', type: 'ADD'}],
      )

      const updated = store.nodes.get('shadow-node')!
      // No predictions extracted, so scoreShadow returns null
      expect(updated.alpha).to.equal(5)
      expect(updated.visitCount).to.equal(0)
    })
  })

  describe('refineIfNeeded', () => {
    it('should return null when no content generator is set', async () => {
      const store = createMockTreeStore()
      const node = createNode({id: 'refine-node'})
      store.nodes.set('refine-node', node)

      const engine = new HarnessEngine({
        config: {domain: 'curation', refinementCooldown: 1},
        // No contentGenerator set
        treeStore: store,
      })
      const service = new CurationHarnessService(engine)

      const result = await service.refineIfNeeded('refine-node')
      expect(result).to.be.null
    })

    it('should return null when cooldown not reached', async () => {
      const {service} = createService()
      const result = await service.refineIfNeeded('some-node')
      expect(result).to.be.null
    })
  })

  describe('setContentGenerator', () => {
    it('should delegate to engine.setContentGenerator', () => {
      const store = createMockTreeStore()
      const engine = new HarnessEngine({
        config: {domain: 'curation'},
        treeStore: store,
      })
      const service = new CurationHarnessService(engine)
      const spy = sandbox.spy(engine, 'setContentGenerator')

      const mockGenerator = createMockContentGenerator()
      service.setContentGenerator(mockGenerator as never)

      expect(spy.calledOnce).to.be.true
      expect(spy.firstCall.args[0]).to.equal(mockGenerator)
    })
  })

  describe('end-to-end: selection → feedback → refinement cycle', () => {
    it('should accumulate statistics across multiple feedback rounds', async () => {
      const store = createMockTreeStore()
      const node = createNode({alpha: 1, beta: 1, heuristic: 0.5, id: 'e2e-node'})
      store.nodes.set('e2e-node', node)

      const {service} = createService(store)

      // 5 successful curations (sequential — each must complete before next)
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await service.recordFeedback('e2e-node', [
          {path: `topic/${i}.md`, status: 'success', type: 'ADD'},
        ])
      }

      const updated = store.nodes.get('e2e-node')!
      expect(updated.alpha).to.equal(6) // 1 + 5 successes
      expect(updated.beta).to.equal(1) // unchanged
      expect(updated.visitCount).to.equal(5)
      expect(updated.heuristic).to.be.closeTo(6 / 7, 0.01) // alpha / (alpha + beta)
    })

    it('should transition from shadow to fast mode as heuristic rises', async () => {
      const store = createMockTreeStore()
      const node = createNode({alpha: 1, beta: 1, heuristic: 0.5, id: 'transition-node'})
      store.nodes.set('transition-node', node)

      const {service} = createService(store)

      // Initially shadow
      let selection = await service.selectTemplate()
      expect(selection!.mode).to.equal('shadow')

      // Record many successes to raise heuristic above 0.9
      for (let i = 0; i < 20; i++) {
        // eslint-disable-next-line no-await-in-loop
        await service.recordFeedback('transition-node', [
          {path: `topic/${i}.md`, status: 'success', type: 'ADD'},
        ])
      }

      const updated = store.nodes.get('transition-node')!
      // 1 + 20 = 21 alpha, 1 beta → heuristic = 21/22 ≈ 0.954
      expect(updated.heuristic).to.be.greaterThan(0.9)

      // Now should be fast mode
      selection = await service.selectTemplate()
      expect(selection!.mode).to.equal('fast')
    })

    it('should accumulate both fast and shadow feedback on same node', async () => {
      const store = createMockTreeStore()
      const templateContent = 'domainRouting:\n  - keywords: [auth]\n    domain: security/authentication'
      const node = createNode({alpha: 5, beta: 2, heuristic: 5 / 7, id: 'mixed-node', templateContent})
      store.nodes.set('mixed-node', node)

      const {service} = createService(store)

      // Shadow feedback (F1 scored)
      await service.recordShadowFeedback(
        node,
        'auth login flow',
        [{path: 'security/authentication', status: 'success', type: 'ADD'}],
      )

      const afterShadow = store.nodes.get('mixed-node')!
      expect(afterShadow.visitCount).to.equal(1)

      // Then execution failure
      await service.recordExecutionFailure('mixed-node', [], 'timeout')

      const afterFailure = store.nodes.get('mixed-node')!
      expect(afterFailure.visitCount).to.equal(2)
      expect(afterFailure.beta).to.be.greaterThan(afterShadow.beta) // penalty applied
    })
  })
})
