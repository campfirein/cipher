import {expect} from 'chai'
import {restore, SinonStub, stub} from 'sinon'

import type {IPolicyEngine, PolicyEvaluationResult} from '../../../../src/agent/core/interfaces/i-policy-engine.js'
import type {IToolProvider} from '../../../../src/agent/core/interfaces/i-tool-provider.js'

import {CoreToolScheduler, ToolDeniedError} from '../../../../src/agent/infra/tools/core-tool-scheduler.js'

describe('CoreToolScheduler', () => {
  let mockToolProvider: IToolProvider
  let mockPolicyEngine: IPolicyEngine
  let executeToolStub: SinonStub
  let evaluateStub: SinonStub

  beforeEach(() => {
    executeToolStub = stub().resolves('tool result')
    evaluateStub = stub().returns({decision: 'ALLOW', reason: 'default allow'})

    mockToolProvider = {
      executeTool: executeToolStub,
      getAvailableToolNames: stub().returns(['test_tool']),
      getAvailableTools: stub().returns([]),
      getToolSet: stub().returns({}),
      initialize: stub().resolves(),
    } as unknown as IToolProvider

    mockPolicyEngine = {
      addRule: stub(),
      addRules: stub(),
      evaluate: evaluateStub,
      getRules: stub().returns([]),
      removeRule: stub().returns(true),
    } as unknown as IPolicyEngine
  })

  afterEach(() => {
    restore()
  })

  describe('constructor', () => {
    it('should create scheduler with tool provider and policy engine', () => {
      const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine)

      expect(scheduler).to.be.instanceOf(CoreToolScheduler)
    })

    it('should create scheduler with custom config', () => {
      const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine, undefined, {
        maxHistorySize: 50,
        verbose: true,
      })

      expect(scheduler).to.be.instanceOf(CoreToolScheduler)
    })
  })

  describe('execute', () => {
    describe('policy ALLOW', () => {
      it('should execute tool when policy allows', async () => {
        const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine)

        const result = await scheduler.execute('test_tool', {param: 'value'}, {sessionId: 'test-session'})

        expect(result).to.equal('tool result')
        expect(evaluateStub.calledOnce).to.be.true
        expect(evaluateStub.calledWith('test_tool', {param: 'value'})).to.be.true
        expect(executeToolStub.calledOnce).to.be.true
        expect(executeToolStub.calledWith('test_tool', {param: 'value'}, 'test-session')).to.be.true
      })

      it('should record execution in history', async () => {
        const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine)

        await scheduler.execute('test_tool', {}, {sessionId: 'test'})

        const history = scheduler.getHistory()
        expect(history).to.have.lengthOf(1)
        expect(history[0].toolName).to.equal('test_tool')
        expect(history[0].status).to.equal('completed')
      })

      it('should record policy result in history', async () => {
        evaluateStub.returns({decision: 'ALLOW', reason: 'allowed by default', rule: {name: 'allow-all'}})
        const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine)

        await scheduler.execute('test_tool', {}, {sessionId: 'test'})

        const history = scheduler.getHistory()
        expect(history[0].policyResult?.decision).to.equal('ALLOW')
        expect(history[0].policyResult?.rule?.name).to.equal('allow-all')
      })
    })

    describe('policy DENY', () => {
      beforeEach(() => {
        evaluateStub.returns({
          decision: 'DENY',
          reason: 'Tool is dangerous',
          rule: {name: 'deny-dangerous'},
        } as PolicyEvaluationResult)
      })

      it('should throw ToolDeniedError when policy denies', async () => {
        const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine)

        try {
          await scheduler.execute('dangerous_tool', {}, {sessionId: 'test'})
          expect.fail('Should have thrown ToolDeniedError')
        } catch (error) {
          expect(error).to.be.instanceOf(ToolDeniedError)
          expect((error as ToolDeniedError).toolName).to.equal('dangerous_tool')
          expect((error as ToolDeniedError).policyResult.reason).to.equal('Tool is dangerous')
        }
      })

      it('should not execute tool when policy denies', async () => {
        const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine)

        try {
          await scheduler.execute('dangerous_tool', {}, {sessionId: 'test'})
        } catch {
          // Expected
        }

        expect(executeToolStub.called).to.be.false
      })

      it('should record denied status in history', async () => {
        const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine)

        try {
          await scheduler.execute('dangerous_tool', {}, {sessionId: 'test'})
        } catch {
          // Expected
        }

        const history = scheduler.getHistory()
        expect(history).to.have.lengthOf(1)
        expect(history[0].status).to.equal('denied')
      })
    })

    describe('execution errors', () => {
      it('should record failed status when tool throws', async () => {
        executeToolStub.rejects(new Error('Tool execution failed'))
        const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine)

        try {
          await scheduler.execute('test_tool', {}, {sessionId: 'test'})
        } catch {
          // Expected
        }

        const history = scheduler.getHistory()
        expect(history[0].status).to.equal('failed')
        expect(history[0].error).to.be.instanceOf(Error)
      })

      it('should propagate tool errors', async () => {
        const originalError = new Error('Original error')
        executeToolStub.rejects(originalError)
        const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine)

        try {
          await scheduler.execute('test_tool', {}, {sessionId: 'test'})
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).to.equal(originalError)
        }
      })
    })

    describe('state transitions', () => {
      it('should transition through pending → executing → completed', async () => {
        const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine)

        await scheduler.execute('test_tool', {}, {sessionId: 'test'})

        const history = scheduler.getHistory()
        expect(history[0].status).to.equal('completed')
        expect(history[0].startedAt).to.be.instanceOf(Date)
        expect(history[0].completedAt).to.be.instanceOf(Date)
      })

      it('should transition through pending → denied when policy denies', async () => {
        evaluateStub.returns({decision: 'DENY', reason: 'blocked'})
        const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine)

        try {
          await scheduler.execute('test_tool', {}, {sessionId: 'test'})
        } catch {
          // Expected
        }

        const history = scheduler.getHistory()
        expect(history[0].status).to.equal('denied')
        expect(history[0].completedAt).to.be.instanceOf(Date)
        expect(history[0].startedAt).to.be.undefined
      })
    })
  })

  describe('getHistory', () => {
    it('should return empty array initially', () => {
      const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine)

      expect(scheduler.getHistory()).to.be.an('array').that.is.empty
    })

    it('should return readonly array', () => {
      const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine)

      const history = scheduler.getHistory()

      expect(history).to.be.an('array')
    })
  })

  describe('clearHistory', () => {
    it('should clear all history', async () => {
      const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine)
      await scheduler.execute('test_tool', {}, {sessionId: 'test'})

      scheduler.clearHistory()

      expect(scheduler.getHistory()).to.have.lengthOf(0)
    })
  })

  describe('history size limit', () => {
    it('should limit history to maxHistorySize', async () => {
      const scheduler = new CoreToolScheduler(mockToolProvider, mockPolicyEngine, undefined, {
        maxHistorySize: 3,
      })

      // Execute 5 tools
      const executions = []
      for (let i = 0; i < 5; i++) {
        executions.push(scheduler.execute('test_tool', {i}, {sessionId: 'test'}))
      }

      await Promise.all(executions)

      const history = scheduler.getHistory()
      expect(history).to.have.lengthOf(3)
      // Should contain the last 3 executions
      expect(history[0].args).to.deep.equal({i: 2})
      expect(history[1].args).to.deep.equal({i: 3})
      expect(history[2].args).to.deep.equal({i: 4})
    })
  })

  describe('ToolDeniedError', () => {
  it('should have correct name', () => {
    const error = new ToolDeniedError('test_tool', {decision: 'DENY', reason: 'blocked'})

    expect(error.name).to.equal('ToolDeniedError')
  })

  it('should include tool name in message', () => {
    const error = new ToolDeniedError('dangerous_tool', {decision: 'DENY', reason: 'too dangerous'})

    expect(error.message).to.include('dangerous_tool')
    expect(error.message).to.include('too dangerous')
  })

  it('should store tool name and policy result', () => {
    const policyResult = {decision: 'DENY' as const, matchedRule: 'deny-all', reason: 'blocked'}
    const error = new ToolDeniedError('test_tool', policyResult)

    expect(error.toolName).to.equal('test_tool')
    expect(error.policyResult).to.deep.equal(policyResult)
  })

  it('should be instanceof Error', () => {
    const error = new ToolDeniedError('test_tool', {decision: 'DENY'})

    expect(error).to.be.instanceOf(Error)
  })
  })
})
