import type {SinonStub} from 'sinon'

import {expect} from 'chai'
import {stub} from 'sinon'

import type {IProjectConfigStore} from '../../../src/server/core/interfaces/storage/i-project-config-store.js'

import {SKIP_COMMANDS, validateBrvConfigVersion} from '../../../src/oclif/hooks/prerun/validate-brv-config-version.js'
import {BRV_CONFIG_VERSION} from '../../../src/server/constants.js'
import {BrvConfig, BrvConfigParams} from '../../../src/server/core/domain/entities/brv-config.js'
import {BrvConfigVersionError} from '../../../src/server/core/domain/errors/brv-config-version-error.js'

describe('validateBrvConfigVersion', () => {
  let errorStub: SinonStub
  let existsStub: SinonStub
  let readStub: SinonStub
  let mockConfigStore: IProjectConfigStore

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
    errorStub = stub().throws(new Error('error() called'))
    existsStub = stub()
    readStub = stub()
    mockConfigStore = {
      exists: existsStub,
      getModifiedTime: stub(),
      read: readStub,
      write: stub(),
    }
  })

  const createErrorContext = () => ({
    error: errorStub,
  })

  describe('should skip validation for excluded commands', () => {
    for (const commandId of SKIP_COMMANDS) {
      it(`skips validation for '${commandId}' command`, async () => {
        await validateBrvConfigVersion(commandId, mockConfigStore, createErrorContext())

        expect(existsStub.called).to.be.false
        expect(readStub.called).to.be.false
        expect(errorStub.called).to.be.false
      })
    }
  })

  describe('should allow commands when config does not exist', () => {
    it('allows command to proceed when config does not exist', async () => {
      existsStub.resolves(false)

      await validateBrvConfigVersion('status', mockConfigStore, createErrorContext())

      expect(existsStub.called).to.be.true
      expect(readStub.called).to.be.false
      expect(errorStub.called).to.be.false
    })
  })

  describe('should allow commands when config has valid version', () => {
    it('allows command to proceed when config version matches', async () => {
      existsStub.resolves(true)
      readStub.resolves(new BrvConfig(validConfigParams))

      await validateBrvConfigVersion('status', mockConfigStore, createErrorContext())

      expect(existsStub.called).to.be.true
      expect(readStub.called).to.be.true
      expect(errorStub.called).to.be.false
    })
  })

  describe('should call error() when config version is invalid', () => {
    it('calls error() when version is missing', async () => {
      existsStub.resolves(true)
      readStub.rejects(
        new BrvConfigVersionError({
          currentVersion: undefined,
          expectedVersion: BRV_CONFIG_VERSION,
        }),
      )

      try {
        await validateBrvConfigVersion('status', mockConfigStore, createErrorContext())
        expect.fail('Expected error to be thrown')
      } catch {
        expect(errorStub.called).to.be.true
        expect(errorStub.firstCall.args[0]).to.include('Config version missing')
      }
    })

    it('calls error() when version is mismatched', async () => {
      existsStub.resolves(true)
      readStub.rejects(
        new BrvConfigVersionError({
          currentVersion: '0.0.0',
          expectedVersion: BRV_CONFIG_VERSION,
        }),
      )

      try {
        await validateBrvConfigVersion('push', mockConfigStore, createErrorContext())
        expect.fail('Expected error to be thrown')
      } catch {
        expect(errorStub.called).to.be.true
        expect(errorStub.firstCall.args[0]).to.include('Config version mismatch')
      }
    })
  })

  describe('should re-throw non-BrvConfigVersionError errors', () => {
    it('re-throws other errors', async () => {
      existsStub.resolves(true)
      readStub.rejects(new Error('Corrupted JSON'))

      try {
        await validateBrvConfigVersion('status', mockConfigStore, createErrorContext())
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).to.be.instanceof(Error)
        expect((error as Error).message).to.equal('Corrupted JSON')
        expect(errorStub.called).to.be.false
      }
    })
  })
})
