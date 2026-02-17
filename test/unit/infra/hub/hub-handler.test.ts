import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {ITransportServer} from '../../../../src/server/core/interfaces/transport/i-transport-server.js'
import type {HubInstallService} from '../../../../src/server/infra/hub/hub-install-service.js'
import type {HubRegistryService} from '../../../../src/server/infra/hub/hub-registry-service.js'

import {HubHandler} from '../../../../src/server/infra/transport/handlers/hub-handler.js'

describe('HubHandler', () => {
  let sandbox: SinonSandbox
  let transport: {
    onRequest: SinonStub
  }
  let registryService: {
    getEntries: SinonStub
    getEntryById: SinonStub
  }
  let installService: {
    install: SinonStub
  }
  let resolveProjectPath: SinonStub

  // Captures the handler callbacks registered via transport.onRequest
  let handlers: Record<string, (...args: unknown[]) => Promise<unknown>>

  beforeEach(() => {
    sandbox = createSandbox()

    handlers = {}
    transport = {
      onRequest: sandbox.stub().callsFake((event: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers[event] = handler
      }),
    }

    registryService = {
      getEntries: sandbox.stub().resolves({entries: [], version: '1.0.0'}),
      getEntryById: sandbox.stub().resolves(),
    }

    installService = {
      install: sandbox.stub().resolves({installedFiles: [], message: 'Installed'}),
    }

    resolveProjectPath = sandbox.stub().returns('/test/project')

    const handler = new HubHandler({
      hubInstallService: installService as unknown as HubInstallService,
      hubRegistryService: registryService as unknown as HubRegistryService,
      resolveProjectPath,
      transport: transport as unknown as ITransportServer,
    })

    handler.setup()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('hub:list', () => {
    it('should register handler and return entries', async () => {
      const mockEntries = [{id: 'test', type: 'bundle'}]
      registryService.getEntries.resolves({entries: mockEntries, version: '2.0.0'})

      const result = await handlers['hub:list']()

      expect(result).to.deep.equal({entries: mockEntries, version: '2.0.0'})
    })
  })

  describe('hub:install', () => {
    it('should return error if entry not found', async () => {
      registryService.getEntryById.resolves()

      const result = await handlers['hub:install']({entryId: 'nonexistent'}, 'client-1')

      expect(result).to.deep.include({
        success: false,
      })
      expect((result as {message: string}).message).to.include('Entry not found')
    })

    it('should install entry and return success', async () => {
      const mockEntry = {id: 'test-skill', type: 'agent-skill'}
      registryService.getEntryById.resolves(mockEntry)
      installService.install.resolves({installedFiles: ['/test/SKILL.md'], message: 'Installed skill'})

      const result = await handlers['hub:install']({agent: 'Claude Code', entryId: 'test-skill'}, 'client-1')

      expect(result).to.deep.include({
        message: 'Installed skill',
        success: true,
      })
      expect(installService.install.calledWith(mockEntry, '/test/project', 'Claude Code')).to.be.true
    })

    it('should pass agent parameter to install service', async () => {
      const mockEntry = {id: 'test-skill', type: 'agent-skill'}
      registryService.getEntryById.resolves(mockEntry)

      await handlers['hub:install']({agent: 'Cursor', entryId: 'test-skill'}, 'client-1')

      expect(installService.install.firstCall.args[2]).to.equal('Cursor')
    })

    it('should pass undefined agent for bundle installs', async () => {
      const mockEntry = {id: 'test-bundle', type: 'bundle'}
      registryService.getEntryById.resolves(mockEntry)

      await handlers['hub:install']({entryId: 'test-bundle'}, 'client-1')

      expect(installService.install.firstCall.args[2]).to.be.undefined
    })

    it('should return error on install failure', async () => {
      const mockEntry = {id: 'test-skill', type: 'agent-skill'}
      registryService.getEntryById.resolves(mockEntry)
      installService.install.rejects(new Error('Agent is required to install a skill'))

      const result = await handlers['hub:install']({entryId: 'test-skill'}, 'client-1')

      expect(result).to.deep.include({
        success: false,
      })
      expect((result as {message: string}).message).to.include('Agent is required')
    })
  })
})
