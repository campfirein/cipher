/* eslint-disable @typescript-eslint/no-explicit-any */
import {expect} from 'chai'
import sinon from 'sinon'

import type {HarnessNode} from '../../../../../src/server/core/interfaces/harness/i-harness-tree-store.js'

import {ReorgHarnessService} from '../../../../../src/server/infra/harness/reorg/reorg-harness-service.js'

function createNode(overrides: Partial<HarnessNode> = {}): HarnessNode {
  return {
    alpha: 1, beta: 1, childIds: [], createdAt: Date.now(),
    heuristic: 0.5, id: 'test-node', metadata: {},
    parentId: null, templateContent: 'mergeDetection:\n  keywordOverlapThreshold: 0.7',
    visitCount: 0, ...overrides,
  }
}

function makeMockEngine(selectResult: null | {mode: 'fast' | 'shadow'; node: HarnessNode} = null): any {
  return {
    recordOutcome: sinon.stub().resolves(),
    recordOutcomeF1: sinon.stub().resolves(),
    runRefinementCycle: sinon.stub().resolves(null),
    selectTemplate: sinon.stub().resolves(selectResult),
    setContentGenerator: sinon.stub(),
    shouldRefine: sinon.stub().returns(false),
  }
}

function makeMockTreeStore(): any {
  return {
    deleteNode: sinon.stub().resolves(),
    getAllNodes: sinon.stub().resolves([]),
    getNode: sinon.stub().resolves(null),
    getRootNode: sinon.stub().resolves(null),
    saveNode: sinon.stub().resolves(),
  }
}

describe('ReorgHarnessService', () => {
  afterEach(() => { sinon.restore() })

  describe('selectTemplate', () => {
    it('returns null for empty tree', async () => {
      const engine = makeMockEngine(null)
      const service = new ReorgHarnessService(engine, makeMockTreeStore())
      const result = await service.selectTemplate()
      expect(result).to.be.null
    })

    it('returns selection when template exists', async () => {
      const node = createNode()
      const engine = makeMockEngine({mode: 'shadow', node})
      const service = new ReorgHarnessService(engine, makeMockTreeStore())
      const result = await service.selectTemplate()
      expect(result).to.not.be.null
      expect(result!.node.id).to.equal('test-node')
    })
  })

  describe('recordFeedback', () => {
    it('calls engine.recordOutcomeF1 with quality-based feedback from metrics', async () => {
      const engine = makeMockEngine()
      const service = new ReorgHarnessService(engine, makeMockTreeStore())
      const results = [{
        candidate: {confidence: 0.9, detectionMetadata: {}, reason: 'test', sourcePaths: ['a.md'], targetPath: 'b.md', type: 'merge' as const},
        changedPaths: ['b.md'],
        qualityMetrics: {postKeywordCount: 5, preKeywordCount: 10},  // 50% dedup
        success: true,
      }]
      await service.recordFeedback('node-1', results)
      expect(engine.recordOutcomeF1.calledOnce).to.be.true
      const [nodeId, alpha] = engine.recordOutcomeF1.firstCall.args
      expect(nodeId).to.equal('node-1')
      expect(alpha).to.be.greaterThan(0.5)  // dedup happened → quality > 0.5
      expect(alpha).to.be.at.most(1)
    })

    it('does not call engine when no results', async () => {
      const engine = makeMockEngine()
      const service = new ReorgHarnessService(engine, makeMockTreeStore())
      await service.recordFeedback('node-1', [])
      expect(engine.recordOutcomeF1.called).to.be.false
    })
  })

  describe('setContentGenerator', () => {
    it('delegates to engine', () => {
      const engine = makeMockEngine()
      const service = new ReorgHarnessService(engine, makeMockTreeStore())
      const mockGen = {} as any
      service.setContentGenerator(mockGen)
      expect(engine.setContentGenerator.calledOnce).to.be.true
    })
  })
})
