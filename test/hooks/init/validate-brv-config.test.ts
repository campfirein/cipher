import type {SinonStub} from 'sinon'

import {expect} from 'chai'
import {stub} from 'sinon'

import type {PatchMarkerDeps} from '../../../src/oclif/hooks/init/validate-brv-config.js'
import type {IProjectConfigStore} from '../../../src/server/core/interfaces/storage/i-project-config-store.js'

import {SKIP_COMMANDS, validateBrvConfigVersion} from '../../../src/oclif/hooks/init/validate-brv-config.js'
import {BRV_CONFIG_VERSION} from '../../../src/server/constants.js'
import {BrvConfig, BrvConfigParams} from '../../../src/server/core/domain/entities/brv-config.js'

describe('validate-brv-config', () => {
  describe('validateBrvConfigVersion', () => {
    let existsStub: SinonStub
    let readStub: SinonStub
    let writeStub: SinonStub
    let mockConfigStore: IProjectConfigStore
    let mockPatchMarkerDeps: PatchMarkerDeps

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
      mockConfigStore = {
        exists: existsStub,
        getModifiedTime: stub(),
        read: readStub,
        write: writeStub,
      }
      // Default: already patched — keeps existing tests focused on version migration
      mockPatchMarkerDeps = {
        isPatched: stub().resolves(true),
        markPatched: stub().resolves(),
      }
    })

    describe('should skip validation for excluded commands', () => {
      for (const commandId of SKIP_COMMANDS) {
        it(`skips validation for '${commandId}' command`, async () => {
          await validateBrvConfigVersion(commandId, mockConfigStore, mockPatchMarkerDeps)

          expect(existsStub.called).to.be.false
          expect(readStub.called).to.be.false
        })
      }
    })

    describe('should throw when project not initialized', () => {
      it('throws instructive error when config does not exist', async () => {
        existsStub.resolves(false)

        try {
          await validateBrvConfigVersion('status', mockConfigStore, mockPatchMarkerDeps)
          expect.fail('Expected error to be thrown')
        } catch (error) {
          expect(error).to.be.instanceof(Error)
          expect((error as Error).message).to.include('not a brv project')
        }
      })

      it('throws user-friendly message for vc commands when config does not exist', async () => {
        existsStub.resolves(false)

        await Promise.all(
          ['vc:status', 'vc:commit', 'vc:push', 'vc:add'].map(async (vcCommand) => {
            try {
              await validateBrvConfigVersion(vcCommand, mockConfigStore, mockPatchMarkerDeps)
              expect.fail(`Expected error for ${vcCommand}`)
            } catch (error) {
              expect(error).to.be.instanceof(Error)
              const {message} = error as Error
              expect(message).to.include('ByteRover version control not initialized')
              expect(message).to.include('brv vc init')
              expect(message).to.not.include('fatal:')
            }
          }),
        )
      })
    })

    describe('should allow commands when config has valid version', () => {
      it('allows command to proceed when config version matches', async () => {
        existsStub.resolves(true)
        readStub.resolves(new BrvConfig(validConfigParams))

        await validateBrvConfigVersion('status', mockConfigStore, mockPatchMarkerDeps)

        expect(existsStub.called).to.be.true
        expect(readStub.called).to.be.true
        expect(writeStub.called).to.be.false
      })
    })

    describe('should migrate config when version is outdated', () => {
      it('migrates config when version is missing (empty string)', async () => {
        existsStub.resolves(true)
        const oldConfig = new BrvConfig({
          ...validConfigParams,
          version: '',
        })
        readStub.resolves(oldConfig)

        await validateBrvConfigVersion('status', mockConfigStore, mockPatchMarkerDeps)

        expect(writeStub.called).to.be.true
        const writtenConfig = writeStub.firstCall.args[0] as BrvConfig
        expect(writtenConfig.version).to.equal(BRV_CONFIG_VERSION)
        // Preserves existing cloud fields
        expect(writtenConfig.spaceId).to.equal('space-123')
        expect(writtenConfig.spaceName).to.equal('test-space')
        expect(writtenConfig.teamId).to.equal('team-456')
        expect(writtenConfig.teamName).to.equal('test-team')
      })

      it('migrates config when version is mismatched', async () => {
        existsStub.resolves(true)
        const oldConfig = new BrvConfig({
          ...validConfigParams,
          version: '0.0.0',
        })
        readStub.resolves(oldConfig)

        await validateBrvConfigVersion('push', mockConfigStore, mockPatchMarkerDeps)

        expect(writeStub.called).to.be.true
        const writtenConfig = writeStub.firstCall.args[0] as BrvConfig
        expect(writtenConfig.version).to.equal(BRV_CONFIG_VERSION)
        // Preserves existing cloud fields
        expect(writtenConfig.spaceId).to.equal('space-123')
        expect(writtenConfig.teamId).to.equal('team-456')
      })
    })

    describe('should apply curate-view patch when marker is absent', () => {
      it('calls markPatched after patching when not yet patched', async () => {
        existsStub.resolves(true)
        readStub.resolves(new BrvConfig(validConfigParams))
        const isPatchedStub = stub().resolves(false)
        const markPatchedStub = stub().resolves()

        await validateBrvConfigVersion('status', mockConfigStore, {
          isPatched: isPatchedStub,
          markPatched: markPatchedStub,
          patchFn: stub().resolves(),
        })

        expect(isPatchedStub.calledOnce).to.be.true
        expect(markPatchedStub.calledOnce).to.be.true
      })

      it('skips patch when marker already exists', async () => {
        existsStub.resolves(true)
        readStub.resolves(new BrvConfig(validConfigParams))
        const markPatchedStub = stub().resolves()

        await validateBrvConfigVersion('status', mockConfigStore, {
          isPatched: stub().resolves(true),
          markPatched: markPatchedStub,
        })

        expect(markPatchedStub.called).to.be.false
      })
    })

    describe('should re-throw errors from read', () => {
      it('re-throws errors', async () => {
        existsStub.resolves(true)
        readStub.rejects(new Error('Corrupted JSON'))

        try {
          await validateBrvConfigVersion('status', mockConfigStore, mockPatchMarkerDeps)
          expect.fail('Expected error to be thrown')
        } catch (error) {
          expect(error).to.be.instanceof(Error)
          expect((error as Error).message).to.equal('Corrupted JSON')
        }
      })
    })
  })
})
