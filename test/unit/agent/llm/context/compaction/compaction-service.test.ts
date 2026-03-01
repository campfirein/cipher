import {expect} from 'chai'
import sinon from 'sinon'

import type {CompactionResult} from '../../../../../../src/agent/core/domain/storage/message-storage-types.js'
import type {ITokenizer} from '../../../../../../src/agent/core/interfaces/i-tokenizer.js'
import type {MessageStorageService} from '../../../../../../src/agent/infra/storage/message-storage-service.js'

import {CompactionService} from '../../../../../../src/agent/infra/llm/context/compaction/compaction-service.js'

function makeStubs() {
  const pruneResult: CompactionResult = {compactedCount: 5, compactionMessageId: 'id-1', tokensSaved: 20_000}

  const messageStorage = {
    pruneToolOutputs: sinon.stub().resolves(pruneResult),
  } as unknown as MessageStorageService

  const tokenizer = {
    countTokens: sinon.stub().resolves(100),
  } as unknown as ITokenizer

  return {messageStorage, pruneResult, tokenizer}
}

describe('CompactionService', () => {
  afterEach(() => sinon.restore())

  describe('checkOverflow', () => {
    it('should return no overflow below threshold', () => {
      const {messageStorage, tokenizer} = makeStubs()
      const service = new CompactionService(messageStorage, tokenizer)
      const result = service.checkOverflow(100_000, 200_000)
      expect(result.isOverflow).to.be.false
      expect(result.recommendation).to.equal('none')
    })

    it('should recommend prune at 85%–95%', () => {
      const {messageStorage, tokenizer} = makeStubs()
      const service = new CompactionService(messageStorage, tokenizer)
      const result = service.checkOverflow(172_000, 200_000) // 86%
      expect(result.isOverflow).to.be.true
      expect(result.recommendation).to.equal('prune')
    })

    it('should recommend compact above 95%', () => {
      const {messageStorage, tokenizer} = makeStubs()
      const service = new CompactionService(messageStorage, tokenizer)
      const result = service.checkOverflow(191_000, 200_000) // 95.5%
      expect(result.isOverflow).to.be.true
      expect(result.recommendation).to.equal('compact')
    })
  })

  describe('pruneToolOutputs — percentage-based thresholds', () => {
    it('should compute keepTokens as 20% of contextLimit (200K model)', async () => {
      const {messageStorage, tokenizer} = makeStubs()
      const service = new CompactionService(messageStorage, tokenizer)

      await service.pruneToolOutputs('session-1', 200_000)

      const stub = messageStorage.pruneToolOutputs as sinon.SinonStub
      expect(stub.calledOnce).to.be.true
      const callArgs = stub.firstCall.args[0]
      expect(callArgs.keepTokens).to.equal(40_000)       // 200K × 20%
      expect(callArgs.minimumTokens).to.equal(20_000)    // 200K × 10%
    })

    it('should scale correctly for 32K model', async () => {
      const {messageStorage, tokenizer} = makeStubs()
      const service = new CompactionService(messageStorage, tokenizer)

      await service.pruneToolOutputs('session-1', 32_000)

      const callArgs = (messageStorage.pruneToolOutputs as sinon.SinonStub).firstCall.args[0]
      expect(callArgs.keepTokens).to.equal(6400)    // 32K × 20%
      expect(callArgs.minimumTokens).to.equal(3200) // 32K × 10%
    })

    it('should scale correctly for 1M Gemini model', async () => {
      const {messageStorage, tokenizer} = makeStubs()
      const service = new CompactionService(messageStorage, tokenizer)

      await service.pruneToolOutputs('session-1', 1_000_000)

      const callArgs = (messageStorage.pruneToolOutputs as sinon.SinonStub).firstCall.args[0]
      expect(callArgs.keepTokens).to.equal(200_000)    // 1M × 20%
      expect(callArgs.minimumTokens).to.equal(100_000) // 1M × 10%
    })

    it('should respect custom percent config', async () => {
      const {messageStorage, tokenizer} = makeStubs()
      const service = new CompactionService(messageStorage, tokenizer, {
        pruneKeepPercent: 0.15,
        pruneMinimumPercent: 0.05,
      })

      await service.pruneToolOutputs('session-1', 200_000)

      const callArgs = (messageStorage.pruneToolOutputs as sinon.SinonStub).firstCall.args[0]
      expect(callArgs.keepTokens).to.equal(30_000)    // 200K × 15%
      expect(callArgs.minimumTokens).to.equal(10_000) // 200K × 5%
    })
  })

  describe('autoCompact', () => {
    it('should call pruneToolOutputs with contextLimit when recommendation is prune', async () => {
      const {messageStorage, tokenizer} = makeStubs()
      const service = new CompactionService(messageStorage, tokenizer)

      await service.autoCompact({contextLimit: 200_000, currentTokens: 172_000, sessionId: 'sess-1'})

      const stub = messageStorage.pruneToolOutputs as sinon.SinonStub
      expect(stub.calledOnce).to.be.true
      const callArgs = stub.firstCall.args[0]
      expect(callArgs.keepTokens).to.equal(40_000)     // 200K × 20%
    })

    it('should return undefined when not overflowing', async () => {
      const {messageStorage, tokenizer} = makeStubs()
      const service = new CompactionService(messageStorage, tokenizer)

      const result = await service.autoCompact({contextLimit: 200_000, currentTokens: 100_000, sessionId: 'sess-1'})
      expect(result).to.be.undefined
      expect((messageStorage.pruneToolOutputs as sinon.SinonStub).called).to.be.false
    })
  })
})
