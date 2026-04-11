import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {IQueryLogStore} from '../../../../src/server/core/interfaces/storage/i-query-log-store.js'

import {QueryLogSummaryUseCase} from '../../../../src/server/infra/usecase/query-log-summary-use-case.js'

// ============================================================================
// Test harness
// ============================================================================

type MockTerminal = {log: SinonStub}

function createUseCase(sandbox: SinonSandbox): {terminal: MockTerminal; useCase: QueryLogSummaryUseCase} {
  const terminal: MockTerminal = {log: sandbox.stub()}
  const queryLogStore = {} as IQueryLogStore
  const useCase = new QueryLogSummaryUseCase({queryLogStore, terminal})
  return {terminal, useCase}
}

function loggedOutput(terminal: MockTerminal): string {
  return terminal.log
    .getCalls()
    .map((c) => String(c.args[0] ?? ''))
    .join('\n')
}

// ============================================================================
// Tests
// ============================================================================

describe('QueryLogSummaryUseCase (stub)', () => {
  let sandbox: SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('format dispatch', () => {
    it('defaults to text format and logs the empty placeholder', async () => {
      const {terminal, useCase} = createUseCase(sandbox)

      await useCase.run({})

      expect(terminal.log.calledOnce).to.be.true
      expect(terminal.log.firstCall.args[0]).to.equal('Query Recall Summary\n(no entries yet)')
    })

    it('explicit format: "text" logs the empty placeholder', async () => {
      const {terminal, useCase} = createUseCase(sandbox)

      await useCase.run({format: 'text'})

      expect(terminal.log.firstCall.args[0]).to.equal('Query Recall Summary\n(no entries yet)')
    })

    it('format: "narrative" logs the empty-state narrative from the formatter', async () => {
      const {terminal, useCase} = createUseCase(sandbox)

      await useCase.run({format: 'narrative'})

      const output = loggedOutput(terminal)
      expect(output).to.include('No queries recorded in the last 24 hours')
      expect(output).to.include('knowledge base is ready')
    })

    it('format: "json" logs valid JSON with a zero summary', async () => {
      const {terminal, useCase} = createUseCase(sandbox)

      await useCase.run({format: 'json'})

      const output = loggedOutput(terminal)
      const parsed = JSON.parse(output)
      expect(parsed.totalQueries).to.equal(0)
      expect(parsed.byStatus).to.deep.equal({cancelled: 0, completed: 0, error: 0})
      expect(parsed.knowledgeGaps).to.deep.equal([])
      expect(parsed.queriesWithoutMatches).to.equal(0)
    })
  })

  describe('options forwarding', () => {
    it('still produces output when after/before are provided', async () => {
      const {terminal, useCase} = createUseCase(sandbox)

      await useCase.run({after: 1000, before: 2000, format: 'text'})

      expect(terminal.log.calledOnce).to.be.true
    })
  })
})
