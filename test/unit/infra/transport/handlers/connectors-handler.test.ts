import type {SinonStub} from 'sinon'

import {expect} from 'chai'
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, stub} from 'sinon'

import {ConnectorsHandler} from '../../../../../src/server/infra/transport/handlers/connectors-handler.js'
import {ConnectorEvents} from '../../../../../src/shared/transport/events/connector-events.js'
import {createMockTransportServer, type MockTransportServer} from '../../../../helpers/mock-factories.js'

describe('ConnectorsHandler — connect bundle', () => {
  let resolveProjectPath: SinonStub
  let transport: MockTransportServer
  let connectorManagerFactory: SinonStub
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'brv-handler-bundle-'))
    resolveProjectPath = stub().returns(tmpRoot)
    transport = createMockTransportServer()
    connectorManagerFactory = stub()
  })

  afterEach(() => {
    rmSync(tmpRoot, {force: true, recursive: true})
    restore()
  })

  function createHandler(): ConnectorsHandler {
    const handler = new ConnectorsHandler({
      connectorManagerFactory: connectorManagerFactory as never,
      resolveProjectPath: resolveProjectPath as never,
      transport,
    })
    handler.setup()
    return handler
  }

  describe('installBundle', () => {
    const DEFAULT_DATA = {agentId: 'Claude Code'}

    async function callBundleHandler(
      data: {agentId: string} = DEFAULT_DATA,
      clientId = 'client-1',
    ): Promise<unknown> {
      createHandler()
      const handlerFn = transport._handlers.get(ConnectorEvents.INSTALL_BUNDLE)
      if (!handlerFn) throw new Error(`No handler registered for ${ConnectorEvents.INSTALL_BUNDLE}`)
      return handlerFn(data, clientId)
    }

    it('registers a handler for connectors:installBundle', () => {
      createHandler()
      expect(transport._handlers.has(ConnectorEvents.INSTALL_BUNDLE)).to.equal(true)
    })

    it('installs the Claude Code bundle and writes artifacts in the resolved project path', async () => {
      const result = (await callBundleHandler({agentId: 'Claude Code'})) as {
        installed: Array<{artifact: string}>
        success: boolean
      }

      expect(result.success).to.equal(true)
      expect(result.installed.map((s) => s.artifact).sort()).to.deep.equal([
        'directive',
        'onboarding-skill',
        'recall-skill',
        'sub-agent',
      ])

      expect(existsSync(join(tmpRoot, '.claude', 'agents', 'byterover.md'))).to.equal(true)
      expect(existsSync(join(tmpRoot, '.claude', 'skills', 'byterover', 'SKILL.md'))).to.equal(true)
      expect(existsSync(join(tmpRoot, '.claude', 'skills', 'byterover-onboarding', 'SKILL.md'))).to.equal(true)
      expect(existsSync(join(tmpRoot, 'CLAUDE.md'))).to.equal(true)
    })

    it('returns success: false with a message when the agent name is unknown', async () => {
      const result = (await callBundleHandler({agentId: 'Bogus Agent'})) as {message: string; success: boolean}
      expect(result.success).to.equal(false)
      expect(result.message).to.include('Bogus Agent')
    })

    it('returns success: false when the agent is known but unsupported by brv connect', async () => {
      const result = (await callBundleHandler({agentId: 'Claude Desktop'})) as {message: string; success: boolean}
      expect(result.success).to.equal(false)
      expect(result.message).to.include('Claude Desktop')
    })
  })

  describe('detectAgents', () => {
    // eslint-disable-next-line unicorn/consistent-function-scoping
    async function callDetectHandler(clientId = 'client-1'): Promise<unknown> {
      createHandler()
      const handlerFn = transport._handlers.get(ConnectorEvents.DETECT_AGENTS)
      if (!handlerFn) throw new Error(`No handler registered for ${ConnectorEvents.DETECT_AGENTS}`)
      return handlerFn({}, clientId)
    }

    it('registers a handler for connectors:detectAgents', () => {
      createHandler()
      expect(transport._handlers.has(ConnectorEvents.DETECT_AGENTS)).to.equal(true)
    })

    it('returns an empty list for a project with no agent markers', async () => {
      const result = (await callDetectHandler()) as {
        detected: Array<{agent: string; evidence: string}>
        projectPath: string
      }
      expect(result.detected).to.deep.equal([])
      expect(result.projectPath).to.equal(tmpRoot)
    })

    it('detects Claude Code when .claude/ exists in the resolved project path', async () => {
      mkdirSync(join(tmpRoot, '.claude'))
      const result = (await callDetectHandler()) as {detected: Array<{agent: string; evidence: string}>}
      expect(result.detected).to.have.lengthOf(1)
      expect(result.detected[0].agent).to.equal('Claude Code')
    })

    it('detects multiple agents when multiple markers exist', async () => {
      mkdirSync(join(tmpRoot, '.claude'))
      mkdirSync(join(tmpRoot, '.cursor'))
      const result = (await callDetectHandler()) as {detected: Array<{agent: string}>}
      const agents = result.detected.map((d) => d.agent).sort()
      expect(agents).to.deep.equal(['Claude Code', 'Cursor'])
    })

    it('detects Github Copilot from .github/copilot-instructions.md', async () => {
      mkdirSync(join(tmpRoot, '.github'))
      writeFileSync(join(tmpRoot, '.github', 'copilot-instructions.md'), '# rules')
      const result = (await callDetectHandler()) as {detected: Array<{agent: string}>}
      expect(result.detected.map((d) => d.agent)).to.include('Github Copilot')
    })
  })
})
