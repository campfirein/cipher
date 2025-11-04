import type {Config} from '@oclif/core'
import type {SinonStub} from 'sinon'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {restore, stub} from 'sinon'

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
    it('shows banner for bare command (br)', async () => {
      // Dynamic import to ensure fresh module
      const {default: hook} = await import('../../../src/hooks/init/welcome.js')

      const context = createContext()
      await hook.call(context, {
        argv: [],
        config,
        context,
        id: undefined,
      })

      expect(logStub.called).to.be.true
    })

    it('shows banner for --help flag (br --help)', async () => {
      const {default: hook} = await import('../../../src/hooks/init/welcome.js')

      const context = createContext()
      await hook.call(context, {
        argv: [],
        config,
        context,
        id: '--help',
      })

      expect(logStub.called).to.be.true
    })

    it('shows banner for help command (br help)', async () => {
      const {default: hook} = await import('../../../src/hooks/init/welcome.js')

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
    it('does not show banner for regular command (br login)', async () => {
      const {default: hook} = await import('../../../src/hooks/init/welcome.js')

      const context = createContext()
      await hook.call(context, {
        argv: ['login'],
        config,
        context,
        id: 'login',
      })

      expect(logStub.called).to.be.false
    })

    it('does not show banner for another regular command (br status)', async () => {
      const {default: hook} = await import('../../../src/hooks/init/welcome.js')

      const context = createContext()
      await hook.call(context, {
        argv: ['status'],
        config,
        context,
        id: 'status',
      })

      expect(logStub.called).to.be.false
    })

    it('does not show banner for command-specific help (br help login)', async () => {
      const {default: hook} = await import('../../../src/hooks/init/welcome.js')

      const context = createContext()
      await hook.call(context, {
        argv: ['help', 'login'],
        config,
        context,
        id: 'help',
      })

      expect(logStub.called).to.be.false
    })

    it('does not show banner for command with --help flag (br login --help)', async () => {
      const {default: hook} = await import('../../../src/hooks/init/welcome.js')

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
