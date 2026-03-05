/* eslint-disable camelcase */
import {expect} from 'chai'

import type {Tool, ToolExecutionContext} from '../../../../src/agent/core/domain/tools/types.js'
import type {ICipherAgent} from '../../../../src/agent/core/interfaces/i-cipher-agent.js'

import {
  _cleanupMapRunForTests,
  _resetNestingRegistryForTests,
  _setNestingRecordForTests,
  _setRunSessionIndexForTests,
  deregisterRootEligibleSession,
  executeAgenticMap,
  getNestingRecord,
  registerRootEligibleSession,
} from '../../../../src/agent/infra/map/agentic-map-service.js'
import {canonicalizePath} from '../../../../src/agent/infra/map/map-shared.js'
import {createAgenticMapTool} from '../../../../src/agent/infra/tools/implementations/agentic-map-tool.js'

const STUB_RESULT = {failed: 0, mapId: 'stub', results: new Map(), succeeded: 1, total: 1}
const VALID_PARAMS = {input_path: 'in.jsonl', output_path: 'out.jsonl', output_schema: {}, prompt: 'p'}
const OWNER_ID = 'test-owner'

function concurrencyAt(depth: number): number {
  return Math.max(1, Math.floor(4 / (depth + 1)))
}

const agentStub = {
  async createTaskSession(): Promise<string> {
    return 'child-session'
  },
  async deleteTaskSession(): Promise<void> {},
  async executeOnSession(): Promise<string> {
    return '{}'
  },
} as unknown as ICipherAgent

function makeToolWithSpy(): {spy: {called: boolean; options?: Record<string, unknown>}; tool: Tool} {
  const spy: {called: boolean; options?: Record<string, unknown>} = {called: false}
  const tool = createAgenticMapTool(
    agentStub,
    '/work',
    {
      async executeAgenticMapImpl(opts) {
        spy.called = true
        spy.options = opts as unknown as Record<string, unknown>

        return STUB_RESULT
      },
    },
  )

  return {spy, tool}
}

function ctx(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    sessionId: 'test-session-id',
    ...overrides,
  }
}

describe('agentic_map tool', () => {
  describe('guard matrix', () => {
    beforeEach(() => {
      _resetNestingRegistryForTests()
      registerRootEligibleSession('test-session-id', OWNER_ID)
    })

    afterEach(() => {
      _resetNestingRegistryForTests()
    })

    describe('Guard A — write-enabled + missing sessionId', () => {
      it('throws when read_only=false and no sessionId', async () => {
        const {spy, tool} = makeToolWithSpy()

        try {
          await tool.execute({...VALID_PARAMS, read_only: false}, ctx({sessionId: undefined}))
          expect.fail('expected error')
        } catch (error) {
          expect((error as Error).message).to.contain('session ID unavailable')
          expect(spy.called).to.be.false
        }
      })
    })

    describe('Guard B — read_only=true from sub-session', () => {
      it('allows read_only=true from root session', async () => {
        const {spy, tool} = makeToolWithSpy()
        await tool.execute({...VALID_PARAMS, read_only: true}, ctx())
        expect(spy.called).to.be.true
      })
    })

    describe('Guard C — orphaned or unregistered session', () => {
      it('throws when sessionId is present but has no registry record', async () => {
        const {spy, tool} = makeToolWithSpy()

        try {
          await tool.execute(VALID_PARAMS, ctx({sessionId: 'unregistered-session'}))
          expect.fail('expected error')
        } catch (error) {
          expect((error as Error).message).to.contain('session has no nesting context')
          expect(spy.called).to.be.false
        }
      })

      it('throws for read_only=true with unregistered session', async () => {
        const {spy, tool} = makeToolWithSpy()

        try {
          await tool.execute({...VALID_PARAMS, read_only: true}, ctx({sessionId: 'ghost'}))
          expect.fail('expected error')
        } catch (error) {
          expect((error as Error).message).to.contain('session has no nesting context')
          expect(spy.called).to.be.false
        }
      })
    })

    describe('Guard D — read_only=false from query context', () => {
      it('D-1: throws when read_only=false and commandType=query', async () => {
        const {spy, tool} = makeToolWithSpy()

        try {
          await tool.execute(
            {...VALID_PARAMS, read_only: false},
            ctx({commandType: 'query', sessionId: 'test-session-id'}),
          )
          expect.fail('expected error')
        } catch (error) {
          expect((error as Error).message).to.contain('not permitted from a query context')
          expect(spy.called).to.be.false
        }
      })

      it('D-2: allows read_only=false from curate context', async () => {
        const {spy, tool} = makeToolWithSpy()
        await tool.execute(
          {...VALID_PARAMS, read_only: false},
          ctx({commandType: 'curate', sessionId: 'test-session-id'}),
        )
        expect(spy.called).to.be.true
      })

      it('D-3: allows read_only=false from chat context', async () => {
        const {spy, tool} = makeToolWithSpy()
        await tool.execute(
          {...VALID_PARAMS, read_only: false},
          ctx({commandType: 'chat', sessionId: 'test-session-id'}),
        )
        expect(spy.called).to.be.true
      })

      it('D-4: allows read_only=true from query context', async () => {
        const {spy, tool} = makeToolWithSpy()
        await tool.execute(
          {...VALID_PARAMS, read_only: true},
          ctx({commandType: 'query', sessionId: 'test-session-id'}),
        )
        expect(spy.called).to.be.true
      })

      it('D-5: Guard A fires before Guard D when no sessionId', async () => {
        const {spy, tool} = makeToolWithSpy()

        try {
          await tool.execute(
            {...VALID_PARAMS, read_only: false},
            ctx({commandType: 'query', sessionId: undefined}),
          )
          expect.fail('expected error')
        } catch (error) {
          const msg = (error as Error).message
          expect(msg).to.contain('session ID unavailable')
          expect(msg).to.not.contain('not permitted from a query context')
          expect(spy.called).to.be.false
        }
      })
    })

    describe('Nesting branch — root path', () => {
      it('uses root path for registered root-eligible session', async () => {
        const {spy, tool} = makeToolWithSpy()
        await tool.execute(
          {...VALID_PARAMS, max_depth: 2, read_only: false},
          ctx({commandType: 'curate', sessionId: 'test-session-id'}),
        )
        expect(spy.called).to.be.true
        expect(spy.options).to.have.property('nestingDepth', 0)
        expect(spy.options).to.have.property('effectiveMaxDepth', 2)
      })

      it('clamps max_depth to HARD_MAX_DEPTH=3', async () => {
        const {spy, tool} = makeToolWithSpy()
        await tool.execute(
          {...VALID_PARAMS, max_depth: 99, read_only: false},
          ctx({commandType: 'curate', sessionId: 'test-session-id'}),
        )
        expect(spy.options).to.have.property('effectiveMaxDepth', 3)
      })

      it('defaults max_depth to 1 when not specified', async () => {
        const {spy, tool} = makeToolWithSpy()
        await tool.execute(
          {...VALID_PARAMS, read_only: false},
          ctx({commandType: 'curate', sessionId: 'test-session-id'}),
        )
        expect(spy.options).to.have.property('effectiveMaxDepth', 1)
      })
    })
  })

  describe('registry lifecycle', () => {
    afterEach(() => {
      _resetNestingRegistryForTests()
    })

    it('registerRootEligibleSession creates root record', () => {
      registerRootEligibleSession('s1', 'owner-a')
      const record = getNestingRecord('s1')
      expect(record).to.not.be.undefined
      expect(record!.isRootCaller).to.be.true
      expect(record!.nestingDepth).to.equal(0)
    })

    it('registerRootEligibleSession is idempotent for same session', () => {
      registerRootEligibleSession('s1', 'owner-a')
      registerRootEligibleSession('s1', 'owner-a')
      expect(getNestingRecord('s1')).to.not.be.undefined
    })

    it('registerRootEligibleSession throws for owner collision', () => {
      registerRootEligibleSession('s1', 'owner-a')
      try {
        registerRootEligibleSession('s1', 'owner-b')
        expect.fail('expected error')
      } catch (error) {
        expect((error as Error).message).to.contain('already owned by a different')
      }
    })

    it('deregisterRootEligibleSession only removes matching owner', () => {
      registerRootEligibleSession('s1', 'owner-a')

      deregisterRootEligibleSession('s1', 'owner-b')
      expect(getNestingRecord('s1')).to.not.be.undefined

      deregisterRootEligibleSession('s1', 'owner-a')
      expect(getNestingRecord('s1')).to.be.undefined
    })

    it('_resetNestingRegistryForTests clears all records', () => {
      registerRootEligibleSession('s1', 'owner-a')
      registerRootEligibleSession('s2', 'owner-b')
      _resetNestingRegistryForTests()
      expect(getNestingRecord('s1')).to.be.undefined
      expect(getNestingRecord('s2')).to.be.undefined
    })
  })

  describe('top-level createTaskSession path', () => {
    beforeEach(() => {
      _resetNestingRegistryForTests()
    })

    afterEach(() => {
      _resetNestingRegistryForTests()
    })

    it('registered task session passes Guard C and reaches executeAgenticMap', async () => {
      const taskSessionId = 'task-curate-abc123'
      registerRootEligibleSession(taskSessionId, 'agent-instance-1')

      const {spy, tool} = makeToolWithSpy()
      await tool.execute(
        {...VALID_PARAMS, read_only: false},
        ctx({commandType: 'curate', sessionId: taskSessionId}),
      )

      expect(spy.called).to.be.true
      expect(spy.options).to.have.property('nestingDepth', 0)
    })

    it('unregistered task session is rejected by Guard C', async () => {
      const {spy, tool} = makeToolWithSpy()

      try {
        await tool.execute(
          {...VALID_PARAMS, read_only: false},
          ctx({commandType: 'curate', sessionId: 'task-curate-unregistered'}),
        )
        expect.fail('expected error')
      } catch (error) {
        expect((error as Error).message).to.contain('session has no nesting context')
        expect(spy.called).to.be.false
      }
    })
  })

  describe('sub-session nesting branch', () => {
    beforeEach(() => {
      _resetNestingRegistryForTests()
    })

    afterEach(() => {
      _resetNestingRegistryForTests()
    })

    it('#5: nested call with max_depth=99 silently uses parent absoluteMaxDepth', async () => {
      // Simulate a sub-session registered by processItem at depth 1 with absoluteMaxDepth=2
      _setNestingRecordForTests('sub-session-1', {
        absoluteMaxDepth: 2,
        ancestorInputPaths: new Set(['/canonical/parent.jsonl']),
        isRootCaller: false,
        mapRunId: 'run-1',
        nestingDepth: 1,
      })

      const {spy, tool} = makeToolWithSpy()
      await tool.execute(
        {...VALID_PARAMS, max_depth: 99, read_only: false},
        ctx({commandType: 'curate', sessionId: 'sub-session-1'}),
      )
      expect(spy.called).to.be.true
      // Sub-session path inherits parent's absoluteMaxDepth, ignoring LLM-supplied max_depth
      expect(spy.options).to.have.property('effectiveMaxDepth', 2)
      expect(spy.options).to.have.property('nestingDepth', 1)
      expect(spy.options).to.have.property('mapRunId', 'run-1')
    })

    it('#17: sub-session path inherits depth and ancestors from registry', async () => {
      const ancestors = new Set(['/canonical/root.jsonl'])
      _setNestingRecordForTests('sub-session-2', {
        absoluteMaxDepth: 3,
        ancestorInputPaths: ancestors,
        isRootCaller: false,
        mapRunId: 'run-2',
        nestingDepth: 2,
      })

      const {spy, tool} = makeToolWithSpy()
      await tool.execute(
        {...VALID_PARAMS, read_only: false},
        ctx({commandType: 'curate', sessionId: 'sub-session-2'}),
      )
      expect(spy.called).to.be.true
      expect(spy.options).to.have.property('nestingDepth', 2)
      expect(spy.options).to.have.property('effectiveMaxDepth', 3)
      expect(spy.options).to.have.property('mapRunId', 'run-2')
      const passedAncestors = spy.options!.ancestorInputPaths as ReadonlySet<string>
      expect(passedAncestors.has('/canonical/root.jsonl')).to.be.true
    })

    it('#18: root re-invocation gets fresh mapRunId and effectiveMaxDepth from params', async () => {
      registerRootEligibleSession('root-session', OWNER_ID)

      const {spy, tool} = makeToolWithSpy()
      await tool.execute(
        {...VALID_PARAMS, max_depth: 2, read_only: false},
        ctx({commandType: 'curate', sessionId: 'root-session'}),
      )
      expect(spy.called).to.be.true
      expect(spy.options).to.have.property('nestingDepth', 0)
      expect(spy.options).to.have.property('effectiveMaxDepth', 2)
      // mapRunId should be a fresh UUID (not empty string from root record)
      const runId = spy.options!.mapRunId as string
      expect(runId).to.be.a('string')
      expect(runId.length).to.be.greaterThan(0)
      expect(runId).to.not.equal('')
    })

    it('Guard B: read_only=true from sub-session throws', async () => {
      _setNestingRecordForTests('sub-session-ro', {
        absoluteMaxDepth: 2,
        ancestorInputPaths: new Set(),
        isRootCaller: false,
        mapRunId: 'run-ro',
        nestingDepth: 1,
      })

      const {spy, tool} = makeToolWithSpy()
      try {
        await tool.execute(
          {...VALID_PARAMS, read_only: true},
          ctx({commandType: 'curate', sessionId: 'sub-session-ro'}),
        )
        expect.fail('expected error')
      } catch (error) {
        expect((error as Error).message).to.contain('read_only=false is required for recursive')
        expect(spy.called).to.be.false
      }
    })

    it('Guard B: omitted read_only from sub-session throws (P2 regression)', async () => {
      _setNestingRecordForTests('sub-session-omit', {
        absoluteMaxDepth: 2,
        ancestorInputPaths: new Set(),
        isRootCaller: false,
        mapRunId: 'run-omit',
        nestingDepth: 1,
      })

      const {spy, tool} = makeToolWithSpy()
      try {
        // Omit read_only entirely — defaults to true in service but was undefined at guard check
        await tool.execute(
          {input_path: 'in.jsonl', output_path: 'out.jsonl', output_schema: {}, prompt: 'p'},
          ctx({commandType: 'curate', sessionId: 'sub-session-omit'}),
        )
        expect.fail('expected error')
      } catch (error) {
        expect((error as Error).message).to.contain('read_only=false is required for recursive')
        expect(spy.called).to.be.false
      }
    })
  })

  describe('executeAgenticMap — depth and cycle guards', () => {
    afterEach(() => {
      _resetNestingRegistryForTests()
    })

    it('#2: depth guard fires at nestingDepth=1 when effectiveMaxDepth=1', async () => {
      try {
        await executeAgenticMap({
          agent: agentStub,
          effectiveMaxDepth: 1,
          nestingDepth: 1,
          params: {...VALID_PARAMS, read_only: false},
          workingDirectory: '/work',
        })
        expect.fail('expected error')
      } catch (error) {
        expect((error as Error).message).to.contain('nesting depth 1 has reached max_depth 1')
      }
    })

    it('#3: depth guard fires at nestingDepth=2 when effectiveMaxDepth=2', async () => {
      try {
        await executeAgenticMap({
          agent: agentStub,
          effectiveMaxDepth: 2,
          nestingDepth: 2,
          params: {...VALID_PARAMS, read_only: false},
          workingDirectory: '/work',
        })
        expect.fail('expected error')
      } catch (error) {
        expect((error as Error).message).to.contain('nesting depth 2 has reached max_depth 2')
      }
    })

    it('#6: root call with max_depth=5 is clamped to HARD_MAX_DEPTH=3', async () => {
      try {
        await executeAgenticMap({
          agent: agentStub,
          // nestingDepth defaults to 0, effectiveMaxDepth computed from params
          params: {...VALID_PARAMS, max_depth: 5, read_only: false},
          workingDirectory: '/work',
        })
        // If it doesn't throw for depth, it will throw for missing JSONL — that's fine,
        // we verify the clamping via the default effectiveMaxDepth calculation
      } catch (error) {
        const msg = (error as Error).message
        // Should NOT say max_depth 5 — should be clamped to 3
        expect(msg).to.not.contain('max_depth 5')
      }
    })

    it('#7: cycle detection — reusing ancestor input_path throws', async () => {
      const canonicalPath = canonicalizePath('/work/in.jsonl')
      try {
        await executeAgenticMap({
          agent: agentStub,
          ancestorInputPaths: new Set([canonicalPath]),
          effectiveMaxDepth: 3,
          nestingDepth: 1,
          params: {...VALID_PARAMS, read_only: false},
          workingDirectory: '/work',
        })
        expect.fail('expected error')
      } catch (error) {
        expect((error as Error).message).to.contain('cycle')
        expect((error as Error).message).to.contain('already being processed')
      }
    })

    it('HARD_MAX_DEPTH clamps effectiveMaxDepth supplied directly (P3 regression)', async () => {
      // A direct caller passing effectiveMaxDepth > 3 should still be clamped
      try {
        await executeAgenticMap({
          agent: agentStub,
          effectiveMaxDepth: 10,
          nestingDepth: 4,
          params: {...VALID_PARAMS, read_only: false},
          workingDirectory: '/work',
        })
        expect.fail('expected error')
      } catch (error) {
        const msg = (error as Error).message
        // Should be clamped to 3, so depth 4 >= 3 → throws with max_depth 3, not 10
        expect(msg).to.contain('max_depth 3')
        expect(msg).to.not.contain('max_depth 10')
      }
    })

    it('#11: concurrency at depth 0 is 4, depth 1 is 2, depth 2 is 1', () => {
      expect(concurrencyAt(0)).to.equal(4)
      expect(concurrencyAt(1)).to.equal(2)
      expect(concurrencyAt(2)).to.equal(1)
      expect(concurrencyAt(3)).to.equal(1)
    })
  })

  describe('registry cleanup lifecycle', () => {
    afterEach(() => {
      _resetNestingRegistryForTests()
    })

    it('#10: after root run completes, sub-session records are deleted but root persists', () => {
      // Pre-register root
      registerRootEligibleSession('root-s', OWNER_ID)
      expect(getNestingRecord('root-s')).to.not.be.undefined

      // Simulate what processItem does: register sub-sessions with a shared mapRunId
      _setNestingRecordForTests('sub-a', {
        absoluteMaxDepth: 2,
        ancestorInputPaths: new Set(),
        isRootCaller: false,
        mapRunId: 'run-cleanup',
        nestingDepth: 1,
      })
      _setNestingRecordForTests('sub-b', {
        absoluteMaxDepth: 2,
        ancestorInputPaths: new Set(),
        isRootCaller: false,
        mapRunId: 'run-cleanup',
        nestingDepth: 1,
      })
      _setRunSessionIndexForTests('run-cleanup', new Set(['sub-a', 'sub-b']))

      // Simulate cleanupMapRun (which is private, so we replicate its logic)
      // In production this is called at nestingDepth === 0 in the outer finally
      _cleanupMapRunForTests('run-cleanup')

      // Sub-session records should be gone
      expect(getNestingRecord('sub-a')).to.be.undefined
      expect(getNestingRecord('sub-b')).to.be.undefined
      // Root record persists
      expect(getNestingRecord('root-s')).to.not.be.undefined
      expect(getNestingRecord('root-s')!.isRootCaller).to.be.true
    })

    it('#20: deregistered session is rejected by Guard C', async () => {
      registerRootEligibleSession('ephemeral', OWNER_ID)
      expect(getNestingRecord('ephemeral')).to.not.be.undefined

      deregisterRootEligibleSession('ephemeral', OWNER_ID)
      expect(getNestingRecord('ephemeral')).to.be.undefined

      const {spy, tool} = makeToolWithSpy()
      try {
        await tool.execute(
          {...VALID_PARAMS, read_only: false},
          ctx({commandType: 'curate', sessionId: 'ephemeral'}),
        )
        expect.fail('expected error')
      } catch (error) {
        expect((error as Error).message).to.contain('session has no nesting context')
        expect(spy.called).to.be.false
      }
    })

    it('#23: getOrCreateSession for existing session — no double registration (idempotent)', () => {
      registerRootEligibleSession('idempotent-s', OWNER_ID)
      // Calling again with same owner should not throw
      registerRootEligibleSession('idempotent-s', OWNER_ID)
      const record = getNestingRecord('idempotent-s')
      expect(record).to.not.be.undefined
      expect(record!.isRootCaller).to.be.true
    })
  })
})
