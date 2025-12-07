import type {Config} from '@oclif/core'
import type {SinonStub} from 'sinon'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {restore, stub} from 'sinon'

import hook from '../../../src/hooks/init/welcome.js'

describe('welcome init hook', () => {
  let config: Config
  let logStub: SinonStub
  let debugStub: SinonStub
  let errorStub: SinonStub
  let exitStub: SinonStub
  let warnStub: SinonStub

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    logStub = stub()
    debugStub = stub()
    errorStub = stub()
    exitStub = stub()
    warnStub = stub()
  })

  afterEach(() => {
    restore()
  })

  const createContext = () => ({
    config,
    debug: debugStub,
    error: errorStub,
    exit: exitStub,
    log: logStub,
    warn: warnStub,
  })

  describe('should show banner for root help', () => {
    it('shows banner for bare command (brv)', async () => {
      const context = createContext()
      await hook.call(context, {
        argv: [],
        config,
        context,
        id: undefined,
      })

      expect(logStub.called).to.be.true
    })

    it('shows banner for --help flag (brv --help)', async () => {
      const context = createContext()
      await hook.call(context, {
        argv: [],
        config,
        context,
        id: '--help',
      })

      expect(logStub.called).to.be.true
    })

    it('shows banner for help command (brv help)', async () => {
      const context = createContext()
      await hook.call(context, {
        argv: [],
        config,
        context,
        id: 'help',
      })

      expect(logStub.called).to.be.true
    })
  })

  describe('should NOT show banner for non-root-help commands', () => {
    it('does not show banner for regular command (brv login)', async () => {
      const context = createContext()
      await hook.call(context, {
        argv: ['login'],
        config,
        context,
        id: 'login',
      })

      expect(logStub.called).to.be.false
    })

    it('does not show banner for another regular command (brv status)', async () => {
      const context = createContext()
      await hook.call(context, {
        argv: ['status'],
        config,
        context,
        id: 'status',
      })

      expect(logStub.called).to.be.false
    })

    it('does not show banner for command-specific help (brv help login)', async () => {
      const context = createContext()
      await hook.call(context, {
        argv: ['help', 'login'],
        config,
        context,
        id: 'help',
      })

      expect(logStub.called).to.be.false
    })

    it('does not show banner for command with --help flag (brv login --help)', async () => {
      const context = createContext()
      await hook.call(context, {
        argv: ['login', '--help'],
        config,
        context,
        id: 'login',
      })

      expect(logStub.called).to.be.false
    })
  })
})
