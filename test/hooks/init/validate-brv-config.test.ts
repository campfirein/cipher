import type {SinonStub} from 'sinon'

import {expect} from 'chai'
import {stub} from 'sinon'

import type {IProjectConfigStore} from '../../../src/server/core/interfaces/storage/i-project-config-store.js'
import type {AutoInitDeps} from '../../../src/server/infra/config/auto-init.js'

import {COMMANDS_NEED_AUTO_INIT, validateBrvConfigVersion} from '../../../src/oclif/hooks/init/validate-brv-config.js'
import {BRV_CONFIG_VERSION} from '../../../src/server/constants.js'
import {BrvConfig, BrvConfigParams} from '../../../src/server/core/domain/entities/brv-config.js'

describe('validate-brv-config', () => {
  describe('validateBrvConfigVersion', () => {
    let existsStub: SinonStub
    let readStub: SinonStub
    let writeStub: SinonStub
    let initializeStub: SinonStub
    let mockConfigStore: IProjectConfigStore
    let mockAutoInitDeps: AutoInitDeps

    const validConfigParams: BrvConfigParams = {
      chatLogPath: '/path/to/chat.log',
      createdAt: '2025-01-01T00:00:00.000Z',
      cwd: '/path/to/project',
      ide: 'Claude Code',
      spaceId: 'space-123',
      spaceName: 'test-space',
      teamId: 'team-456',
      teamName: 'test-team',
      version: BRV_CONFIG_VERSION,
    }

    beforeEach(() => {
      existsStub = stub()
      readStub = stub()
      writeStub = stub().resolves()
      initializeStub = stub().resolves('/path/.brv/context-tree')
      mockConfigStore = {
        exists: existsStub,
        getModifiedTime: stub(),
        read: readStub,
        write: writeStub,
      }
      mockAutoInitDeps = {
        contextTreeService: {
          delete: stub().resolves(),
          exists: stub().resolves(false),
          hasGitRepo: stub().resolves(false),
          initialize: initializeStub,
          resolvePath: stub().returns('/path/.brv/context-tree'),
        },
        projectConfigStore: mockConfigStore,
      }
    })

    describe('should skip when help flags are present', () => {
      for (const flag of ['--help', '-h', '--h', '-help']) {
        it(`skips auto-init when '${flag}' is in argv`, async () => {
          existsStub.resolves(false)

          await validateBrvConfigVersion('curate', mockConfigStore, [flag], mockAutoInitDeps)

          expect(existsStub.called).to.be.false
          expect(initializeStub.called).to.be.false
        })
      }
    })

    describe('should not auto-init for commands not in COMMANDS_NEED_AUTO_INIT', () => {
      const nonAutoInitCommands = ['status', 'push', 'pull', 'vc:status', 'providers']

      for (const commandId of nonAutoInitCommands) {
        it(`does not auto-init for '${commandId}' command`, async () => {
          existsStub.resolves(false)

          await validateBrvConfigVersion(commandId, mockConfigStore, [], mockAutoInitDeps)

          expect(initializeStub.called).to.be.false
        })
      }
    })

    describe('should auto-init for commands in COMMANDS_NEED_AUTO_INIT', () => {
      for (const commandId of COMMANDS_NEED_AUTO_INIT) {
        it(`auto-initializes .brv/ for '${commandId}' when config does not exist`, async () => {
          existsStub.resolves(false)
          readStub.resolves(new BrvConfig(validConfigParams))

          await validateBrvConfigVersion(commandId, mockConfigStore, [], mockAutoInitDeps)

          expect(initializeStub.calledOnce).to.be.true
        })
      }

      it('skips auto-init when config already exists', async () => {
        existsStub.resolves(true)

        await validateBrvConfigVersion('curate', mockConfigStore, [], mockAutoInitDeps)

        expect(initializeStub.called).to.be.false
      })
    })

    describe('should migrate config version after auto-init', () => {
      it('migrates config when version is outdated', async () => {
        existsStub.resolves(false)
        const oldConfig = new BrvConfig({
          ...validConfigParams,
          version: '0.0.0',
        })
        readStub.resolves(oldConfig)

        await validateBrvConfigVersion('curate', mockConfigStore, [], mockAutoInitDeps)

        // writeStub called twice: once by ensureProjectInitialized, once for version migration
        expect(writeStub.callCount).to.equal(2)
        const migratedConfig = writeStub.secondCall.args[0] as BrvConfig
        expect(migratedConfig.version).to.equal(BRV_CONFIG_VERSION)
      })

      it('does not migrate when version matches', async () => {
        existsStub.resolves(false)
        readStub.resolves(new BrvConfig(validConfigParams))

        await validateBrvConfigVersion('curate', mockConfigStore, [], mockAutoInitDeps)

        // writeStub called once: only by ensureProjectInitialized, no version migration
        expect(writeStub.callCount).to.equal(1)
      })
    })

    describe('should throw when config is corrupt after auto-init', () => {
      it('throws when read returns null', async () => {
        existsStub.resolves(false)
        readStub.resolves(null)

        try {
          await validateBrvConfigVersion('curate', mockConfigStore, [], mockAutoInitDeps)
          expect.fail('Expected error to be thrown')
        } catch (error) {
          expect(error).to.be.instanceof(Error)
          expect((error as Error).message).to.include('corrupt or unreadable config')
        }
      })
    })
  })
})
