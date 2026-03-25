
import {expect} from 'chai'
import sinon from 'sinon'

import type {IContentGenerator} from '../../../../../src/agent/core/interfaces/i-content-generator.js'
import type {HarnessNode, IHarnessTreeStore} from '../../../../../src/server/core/interfaces/harness/i-harness-tree-store.js'

import {HarnessEngine} from '../../../../../src/server/infra/harness/harness-engine.js'
import {
  DECOMPOSE_ROOT_TEMPLATE,
  QueryHarnessService,
} from '../../../../../src/server/infra/harness/query/query-harness-service.js'

function makeNode(overrides: Partial<HarnessNode> = {}): HarnessNode {
  return {
    alpha: 1,
    beta: 1,
    childIds: [],
    createdAt: Date.now(),
    heuristic: 0.5,
    id: overrides.id ?? 'node-1',
    metadata: {},
    parentId: null,
    templateContent: overrides.templateContent ?? 'synonyms: {}\ndomainHints: []\n',
    visitCount: 0,
    ...overrides,
  }
}

function createMockTreeStore(): IHarnessTreeStore {
  return {
    deleteNode: sinon.stub().resolves(),
    getAllNodes: sinon.stub().resolves([]),
    getNode: sinon.stub().resolves(null),
    getRootNode: sinon.stub().resolves(null),
    saveNode: sinon.stub().resolves(),
  }
}

function createService(treeStore?: IHarnessTreeStore) {
  const store = treeStore ?? createMockTreeStore()

  const decomposeEngine = new HarnessEngine({config: {domain: 'query/decompose'}, treeStore: store})
  const boostEngine = new HarnessEngine({config: {domain: 'query/boost'}, treeStore: store})
  const rerankEngine = new HarnessEngine({config: {domain: 'query/rerank'}, treeStore: store})

  const service = new QueryHarnessService({
    boostEngine,
    decomposeEngine,
    rerankEngine,
    treeStore: store,
  })

  return {boostEngine, decomposeEngine, rerankEngine, service, store}
}

describe('QueryHarnessService', () => {
  afterEach(() => {
    sinon.restore()
  })

  describe('decomposeQuery', () => {
    it('falls back to default template when tree is empty', async () => {
      const {service} = createService()
      const {decomposed} = await service.decomposeQuery('test query')
      expect(decomposed.originalQuery).to.equal('test query')
      expect(decomposed.expandedTerms).to.deep.equal([])
    })

    it('uses template from engine selection and returns nodeId', async () => {
      const {decomposeEngine, service} = createService()
      const templateContent = 'synonyms:\n  test:\n    - exam\n    - quiz\ndomainHints: []\n'
      sinon.stub(decomposeEngine, 'selectTemplate').resolves({
        mode: 'fast' as const,
        node: makeNode({id: 'decompose-node', templateContent}),
      })

      const {decomposed, nodeId} = await service.decomposeQuery('test query')
      expect(decomposed.expandedTerms).to.include('exam')
      expect(nodeId).to.equal('decompose-node')
    })
  })

  describe('adjustBoosts', () => {
    it('applies adjustments and returns nodeId', async () => {
      const {boostEngine, service} = createService()
      const templateContent = 'scoreAdjustments:\n  domainMatchBonus: 1\n  titleMatchBonus: 0\n  crossReferenceBonus: 0\n'
      sinon.stub(boostEngine, 'selectTemplate').resolves({
        mode: 'fast' as const,
        node: makeNode({id: 'boost-node', templateContent}),
      })

      const results = [{excerpt: 'e', path: '/p', score: 1, symbolPath: 'auth/login/handler', title: 'Login'}]
      const {nodeId, results: adjusted} = await service.adjustBoosts(results, 'query', ['auth'])
      // Score clamped to [0, 0.9999] to prevent false Tier-2 direct hits
      expect(adjusted[0].score).to.equal(0.9999)
      expect(nodeId).to.equal('boost-node')
    })
  })

  describe('recordOutcome', () => {
    it('delegates to engines with explicit nodeIds', async () => {
      const {boostEngine, decomposeEngine, rerankEngine, service} = createService()
      const recordD = sinon.stub(decomposeEngine, 'recordOutcome').resolves()
      const recordB = sinon.stub(boostEngine, 'recordOutcome').resolves()
      const recordR = sinon.stub(rerankEngine, 'recordOutcome').resolves()

      await service.recordOutcome(
        {boost: 'b-1', decompose: 'd-1', rerank: 'r-1'},
        {directHit: true, ood: false, prefetched: false, supplemented: false, tier: 2},
      )

      expect(recordD.calledOnce).to.equal(true)
      expect(recordB.calledOnce).to.equal(true)
      expect(recordR.calledOnce).to.equal(true)
    })

    it('uses recordOutcomeF1 for prefetched non-direct-hit', async () => {
      const {decomposeEngine, service} = createService()
      const recordF1 = sinon.stub(decomposeEngine, 'recordOutcomeF1').resolves()

      await service.recordOutcome(
        {decompose: 'd-1'},
        {directHit: false, ood: false, prefetched: true, supplemented: false, tier: 3},
      )

      expect(recordF1.calledOnce).to.equal(true)
      expect(recordF1.firstCall.args[1]).to.equal(0.7)
    })

    it('penalizes decompose but rewards boost on prefetched + supplemented', async () => {
      const {boostEngine, decomposeEngine, service} = createService()
      const recordD = sinon.stub(decomposeEngine, 'recordOutcome').resolves()
      const recordDF1 = sinon.stub(decomposeEngine, 'recordOutcomeF1').resolves()
      const recordBF1 = sinon.stub(boostEngine, 'recordOutcomeF1').resolves()
      const recordB = sinon.stub(boostEngine, 'recordOutcome').resolves()

      await service.recordOutcome(
        {boost: 'b-1', decompose: 'd-1'},
        {directHit: false, ood: false, prefetched: true, supplemented: true, tier: 3},
      )

      // Decompose: supplemented → success=false → binary recordOutcome (failure), NOT F1
      expect(recordD.calledOnce).to.equal(true)
      expect(recordD.firstCall.args[0].success).to.equal(false)
      expect(recordDF1.called).to.equal(false)

      // Boost: success=true + prefetched → partial-success F1(0.7, 0.3)
      expect(recordBF1.calledOnce).to.equal(true)
      expect(recordBF1.firstCall.args[1]).to.equal(0.7)
      expect(recordB.called).to.equal(false)
    })
  })

  describe('refineIfNeeded', () => {
    it('calls runRefinementCycle with explicit nodeIds', async () => {
      const {boostEngine, decomposeEngine, service} = createService()
      const refineD = sinon.stub(decomposeEngine, 'runRefinementCycle').resolves(null)
      const refineB = sinon.stub(boostEngine, 'runRefinementCycle').resolves(null)

      await service.refineIfNeeded({boost: 'b-1', decompose: 'd-1'})

      expect(refineD.calledOnce).to.equal(true)
      expect(refineD.firstCall.args[0]).to.equal('d-1')
      expect(refineB.calledOnce).to.equal(true)
      expect(refineB.firstCall.args[0]).to.equal('b-1')
    })
  })

  describe('setContentGenerator', () => {
    it('delegates to all three engines', () => {
      const {boostEngine, decomposeEngine, rerankEngine, service} = createService()
      const setD = sinon.stub(decomposeEngine, 'setContentGenerator')
      const setB = sinon.stub(boostEngine, 'setContentGenerator')
      const setR = sinon.stub(rerankEngine, 'setContentGenerator')

      service.setContentGenerator({} as IContentGenerator)

      expect(setD.calledOnce).to.equal(true)
      expect(setB.calledOnce).to.equal(true)
      expect(setR.calledOnce).to.equal(true)
    })
  })

  describe('cold-start', () => {
    it('seeds root node when tree is empty', async () => {
      const store = createMockTreeStore()
      const getAllNodes = store.getAllNodes as sinon.SinonStub
      let callCount = 0
      getAllNodes.callsFake(async () => {
        callCount++
        if (callCount <= 1) return []

        return [makeNode({id: 'seeded-root', templateContent: DECOMPOSE_ROOT_TEMPLATE})]
      })

      const {service} = createService(store)
      const {decomposed} = await service.decomposeQuery('test')

      expect((store.saveNode as sinon.SinonStub).called).to.equal(true)
      expect(decomposed.originalQuery).to.equal('test')
    })
  })
})
