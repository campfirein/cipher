/* eslint-disable camelcase */
import {expect} from 'chai'
import sinon from 'sinon'

import {buildCliMetadata} from '../../../../src/oclif/lib/build-cli-metadata.js'
import {CliMetadataSchema} from '../../../../src/shared/analytics/cli-metadata-schema.js'

const ENV_KEYS_TOUCHED = ['CI', 'TERM_PROGRAM', 'npm_config_user_agent'] as const

const setIsTty = (value: boolean): void => {
  Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value, writable: true})
}

describe('buildCliMetadata', () => {
  let originalEnv: Record<string, string | undefined>
  let originalIsTtyDescriptor: PropertyDescriptor | undefined
  let clock: sinon.SinonFakeTimers

  beforeEach(() => {
    originalEnv = {}
    for (const key of ENV_KEYS_TOUCHED) {
      originalEnv[key] = process.env[key]
      delete process.env[key]
    }

    originalIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    setIsTty(false)
    clock = sinon.useFakeTimers(1_700_000_000_000)
  })

  afterEach(() => {
    for (const key of ENV_KEYS_TOUCHED) {
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key]
    }

    if (originalIsTtyDescriptor) {
      Object.defineProperty(process.stdout, 'isTTY', originalIsTtyDescriptor)
    } else {
      Reflect.deleteProperty(process.stdout, 'isTTY')
    }

    clock.restore()
  })

  it('produces a CliMetadataSchema-parseable object', () => {
    const result = buildCliMetadata('query', {format: 'text'})
    expect(CliMetadataSchema.safeParse(result).success).to.equal(true)
  })

  it('sets command_id from the first argument and flag_names from Object.keys(flags)', () => {
    const result = buildCliMetadata('vc:add', {detach: true, format: 'text'})
    expect(result.command_id).to.equal('vc:add')
    expect(result.flag_names).to.have.members(['detach', 'format'])
    expect(result.flag_names).to.have.lengthOf(2)
  })

  it('emits an empty flag_names array when no flags passed', () => {
    const result = buildCliMetadata('status', {})
    expect(result.flag_names).to.deep.equal([])
  })

  it('sets client_sent_at to Date.now() (mocked here)', () => {
    const result = buildCliMetadata('query', {})
    expect(result.client_sent_at).to.equal(1_700_000_000_000)
  })

  describe('is_ci', () => {
    it('false when CI env unset', () => {
      const result = buildCliMetadata('query', {})
      expect(result.is_ci).to.equal(false)
    })

    it('true when CI=true', () => {
      process.env.CI = 'true'
      const result = buildCliMetadata('query', {})
      expect(result.is_ci).to.equal(true)
    })

    it('true when CI=1', () => {
      process.env.CI = '1'
      const result = buildCliMetadata('query', {})
      expect(result.is_ci).to.equal(true)
    })

    it('false when CI=false (opt-out by convention)', () => {
      process.env.CI = 'false'
      const result = buildCliMetadata('query', {})
      expect(result.is_ci).to.equal(false)
    })
  })

  describe('is_tty', () => {
    it('false when stdout.isTTY is false', () => {
      setIsTty(false)
      const result = buildCliMetadata('query', {})
      expect(result.is_tty).to.equal(false)
    })

    it('true when stdout.isTTY is true', () => {
      setIsTty(true)
      const result = buildCliMetadata('query', {})
      expect(result.is_tty).to.equal(true)
    })
  })

  describe('package_manager', () => {
    it('npm when npm_config_user_agent starts with "npm/"', () => {
      process.env.npm_config_user_agent = 'npm/10.2.4 node/v20.0.0 darwin x64'
      expect(buildCliMetadata('q', {}).package_manager).to.equal('npm')
    })

    it('yarn when npm_config_user_agent starts with "yarn/"', () => {
      process.env.npm_config_user_agent = 'yarn/1.22.19 npm/? node/v20.0.0 darwin x64'
      expect(buildCliMetadata('q', {}).package_manager).to.equal('yarn')
    })

    it('pnpm when npm_config_user_agent starts with "pnpm/"', () => {
      process.env.npm_config_user_agent = 'pnpm/8.10.0 npm/? node/v20.0.0 darwin x64'
      expect(buildCliMetadata('q', {}).package_manager).to.equal('pnpm')
    })

    it('bun when npm_config_user_agent starts with "bun/"', () => {
      process.env.npm_config_user_agent = 'bun/1.0.0 (linux x64)'
      expect(buildCliMetadata('q', {}).package_manager).to.equal('bun')
    })

    it('unknown when npm_config_user_agent unset', () => {
      expect(buildCliMetadata('q', {}).package_manager).to.equal('unknown')
    })

    it('unknown when npm_config_user_agent is some unrecognised prefix', () => {
      process.env.npm_config_user_agent = 'rush/5 node/v20 darwin x64'
      expect(buildCliMetadata('q', {}).package_manager).to.equal('unknown')
    })
  })

  describe('runtime', () => {
    it('node when process.versions.bun is absent (default test env)', () => {
      expect(buildCliMetadata('q', {}).runtime).to.equal('node')
    })
  })

  describe('terminal_program', () => {
    it('omitted when TERM_PROGRAM unset', () => {
      const result = buildCliMetadata('q', {})
      expect(result).to.not.have.property('terminal_program')
    })

    it('omitted when TERM_PROGRAM is empty string', () => {
      process.env.TERM_PROGRAM = ''
      const result = buildCliMetadata('q', {})
      expect(result).to.not.have.property('terminal_program')
    })

    it('included verbatim when TERM_PROGRAM is non-empty', () => {
      process.env.TERM_PROGRAM = 'WezTerm'
      const result = buildCliMetadata('q', {})
      expect(result.terminal_program).to.equal('WezTerm')
    })
  })

  it('does not mutate the input flags object', () => {
    const flags = {detach: true}
    buildCliMetadata('q', flags)
    expect(flags).to.deep.equal({detach: true})
  })

  it('returns a fresh object per call (no shared mutable state)', () => {
    const a = buildCliMetadata('q', {})
    const b = buildCliMetadata('q', {})
    expect(a).to.not.equal(b)
  })
})
