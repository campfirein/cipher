import {expect} from 'chai'
import {fileURLToPath} from 'node:url'

import type {AgentEntry, TurnEvent} from '../../../../../src/server/core/domain/channel/types.js'

import {AcpHandshakeError, AgentNotInstalledError, NotImplementedError, TurnCancelledError} from '../../../../../src/server/core/domain/channel/errors.js'
import {AcpDriver, createDriver} from '../../../../../src/server/infra/channel/drivers/acp-driver.js'
import {lookbackPacketFixture} from '../../../../helpers/channel-fixtures.js'

const FIXTURE_PATH = fileURLToPath(new URL('../../../../helpers/mock-acp-server.mjs', import.meta.url))

const NODE_BIN = process.execPath
const COMMON_NODE_ARGS = ['--no-warnings', FIXTURE_PATH]

interface StdioOverrides {
  args?: string[]
  command?: string
  env?: Record<string, string>
}

function makeEntry(overrides: StdioOverrides = {}, agentId = 'mock-acp-test'): AgentEntry {
  return {
    displayName: 'Mock ACP',
    id: agentId,
    launch: {
      args: overrides.args ?? COMMON_NODE_ARGS,
      command: overrides.command ?? NODE_BIN,
      env: overrides.env ?? {MOCK_ACP_SCENARIO: 'echo'},
      kind: 'stdio',
    },
    role: 'coding-agent',
  }
}

function promptInput(turnId = 't-001') {
  return {
    channelId: 'ping-pong',
    lookback: lookbackPacketFixture,
    prompt: 'hello',
    turnId,
  }
}

async function collect(iterable: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

describe('AcpDriver', () => {
  describe('createDriver factory', () => {
    it('throws NotImplementedError for kind: tcp', () => {
      const entry: AgentEntry = {
        displayName: 'Remote',
        id: 'remote',
        launch: {host: 'localhost', kind: 'tcp', port: 9000},
        role: 'coding-agent',
      }
      expect(() => createDriver(entry, {cwd: process.cwd()})).to.throw(NotImplementedError)
    })

    it('returns an AcpDriver for kind: stdio', () => {
      const driver = createDriver(makeEntry(), {cwd: process.cwd()})
      expect(driver).to.be.instanceOf(AcpDriver)
    })
  })

  describe('echo scenario', () => {
    it('yields at least one token event and settles cleanly', async () => {
      const driver = new AcpDriver({cwd: process.cwd(), entry: makeEntry({env: {MOCK_ACP_SCENARIO: 'echo'}})})
      try {
        const events = await collect(driver.prompt(promptInput()))
        const tokens = events.filter((event) => event.kind === 'token')
        expect(tokens.length).to.be.greaterThan(0)
        const text = tokens.map((event) => (event.kind === 'token' ? event.delta : '')).join('')
        expect(text).to.match(/mock echo: hello/)
      } finally {
        await driver.forceClose()
      }
    }).timeout(10_000)
  })

  describe('stream-50 scenario', () => {
    it('yields at least 50 token events', async () => {
      const driver = new AcpDriver({cwd: process.cwd(), entry: makeEntry({env: {MOCK_ACP_SCENARIO: 'stream-50'}})})
      try {
        const events = await collect(driver.prompt(promptInput('t-002')))
        const tokens = events.filter((event) => event.kind === 'token')
        expect(tokens.length).to.equal(50)
      } finally {
        await driver.forceClose()
      }
    }).timeout(10_000)
  })

  describe('fail-after-100ms scenario', () => {
    it('throws an Error during prompt iteration', async () => {
      const driver = new AcpDriver({cwd: process.cwd(), entry: makeEntry({env: {MOCK_ACP_SCENARIO: 'fail-after-100ms'}})})
      let threw = false
      try {
        await collect(driver.prompt(promptInput('t-003')))
      } catch (error) {
        threw = true
        expect(error).to.be.instanceOf(Error)
      } finally {
        await driver.forceClose()
      }

      expect(threw).to.equal(true)
    }).timeout(10_000)
  })

  describe('cancel + close', () => {
    it('requestCancel during stream-50 throws TurnCancelledError and exits within 2s', async () => {
      const driver = new AcpDriver({cwd: process.cwd(), entry: makeEntry({env: {MOCK_ACP_SCENARIO: 'stream-50'}})})
      const start = Date.now()
      let caught: unknown
      try {
        const events: TurnEvent[] = []
        const iter = driver.prompt(promptInput('t-004'))[Symbol.asyncIterator]()
        const first = await iter.next()
        if (!first.done) events.push(first.value)
        await driver.requestCancel()
        // Drain remaining events; iterator must terminate via TurnCancelledError so the
        // orchestrator knows to persist `state: 'cancelled'` (Codex F4 review fix).
        let next = await iter.next()
        while (!next.done) {
          events.push(next.value)
          // eslint-disable-next-line no-await-in-loop -- intentional iteration
          next = await iter.next()
        }
      } catch (error) {
        caught = error
      } finally {
        await driver.forceClose()
      }

      expect(caught).to.be.instanceOf(TurnCancelledError)
      expect(Date.now() - start).to.be.lessThan(3000)
    }).timeout(10_000)

    // Codex re-review Finding 2 — when soft cancel is followed by forceClose() (hard escalation),
    // the SDK rejects the prompt promise. The driver must convert that rejection into
    // TurnCancelledError so the orchestrator persists `state: 'cancelled'` instead of `failed`.
    it('hard cancel via forceClose during stream-50 surfaces as TurnCancelledError, not generic failure', async () => {
      const driver = new AcpDriver({cwd: process.cwd(), entry: makeEntry({env: {MOCK_ACP_SCENARIO: 'stream-50'}})})
      let caught: unknown
      try {
        const iter = driver.prompt(promptInput('t-cancel-hard'))[Symbol.asyncIterator]()
        const first = await iter.next()
        if (first.done) throw new Error('expected at least one event before cancel')
        // Soft cancel sets `cancelRequestedFor`; hard close tears down the SDK connection so the
        // outstanding prompt promise rejects (simulating an ACP server that ignored the soft cancel).
        await driver.requestCancel()
        await driver.forceClose()
        // Drain remaining events; iterator must terminate via TurnCancelledError.
        let next = await iter.next()
        while (!next.done) {
          // eslint-disable-next-line no-await-in-loop -- intentional drain
          next = await iter.next()
        }
      } catch (error) {
        caught = error
      } finally {
        await driver.forceClose()
      }

      expect(caught).to.be.instanceOf(TurnCancelledError)
    }).timeout(10_000)

    it('forceClose is idempotent', async () => {
      const driver = new AcpDriver({cwd: process.cwd(), entry: makeEntry({env: {MOCK_ACP_SCENARIO: 'echo'}})})
      await collect(driver.prompt(promptInput('t-005')))
      await driver.forceClose()
      await driver.forceClose()  // second call is a no-op
    }).timeout(10_000)
  })

  describe('concurrent prompt serialization (Codex re-review Finding 2)', () => {
    // Two concurrent prompts on the same driver instance must not corrupt routing — the second
    // must wait for the first to settle so the singleton `currentQueue`/`currentTurnId` fields
    // aren't overwritten mid-stream.
    it('serializes concurrent prompts on the same driver (second waits for first)', async () => {
      const driver = new AcpDriver({cwd: process.cwd(), entry: makeEntry({env: {MOCK_ACP_SCENARIO: 'echo'}})})
      try {
        const order: string[] = []
        const first = (async () => {
          await collect(driver.prompt(promptInput('t-concurrent-A')))
          order.push('first-done')
        })()
        const second = (async () => {
          await collect(driver.prompt(promptInput('t-concurrent-B')))
          order.push('second-done')
        })()
        await Promise.all([first, second])
        // The second prompt cannot complete before the first — the mutex serialises them.
        expect(order).to.deep.equal(['first-done', 'second-done'])
      } finally {
        await driver.forceClose()
      }
    }).timeout(10_000)
  })

  describe('session reuse', () => {
    it('a second prompt() on the same instance reuses the existing ACP session', async () => {
      const driver = new AcpDriver({cwd: process.cwd(), entry: makeEntry({env: {MOCK_ACP_SCENARIO: 'echo'}})})
      try {
        await collect(driver.prompt(promptInput('t-006a')))
        const sessionIdBefore = driver.debugSessionId()
        await collect(driver.prompt(promptInput('t-006b')))
        const sessionIdAfter = driver.debugSessionId()
        expect(sessionIdBefore).to.be.a('string').and.not.empty
        expect(sessionIdAfter).to.equal(sessionIdBefore)
      } finally {
        await driver.forceClose()
      }
    }).timeout(10_000)
  })

  describe('failure modes', () => {
    it('rejects with AcpHandshakeError when the subprocess exits before initialize', async () => {
      const driver = new AcpDriver({
        cwd: process.cwd(),
        entry: {
          displayName: 'Bad',
          id: 'bad',
          launch: {args: ['-e', 'process.exit(1)'], command: NODE_BIN, kind: 'stdio'},
          role: 'coding-agent',
        },
      })
      let caught: unknown
      try {
        await collect(driver.prompt(promptInput('t-007')))
      } catch (error) {
        caught = error
      } finally {
        await driver.forceClose()
      }

      expect(caught).to.be.instanceOf(AcpHandshakeError)
    }).timeout(10_000)

    it('rejects with AgentNotInstalledError when the binary is absent (ENOENT)', async () => {
      const driver = new AcpDriver({
        cwd: process.cwd(),
        entry: {
          displayName: 'Missing',
          id: 'missing',
          launch: {args: [], command: '/__definitely_not_a_real_binary__', kind: 'stdio'},
          role: 'coding-agent',
          // No installCommand on launch — driver supplies a default hint.
        },
      })
      let caught: unknown
      try {
        await collect(driver.prompt(promptInput('t-008')))
      } catch (error) {
        caught = error
      } finally {
        await driver.forceClose()
      }

      expect(caught).to.be.instanceOf(AgentNotInstalledError)
    }).timeout(10_000)
  })
})
