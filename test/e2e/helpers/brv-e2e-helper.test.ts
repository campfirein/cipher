import {expect} from 'chai'
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'

import type {E2eConfig} from './env-guard.js'

import {BrvE2eHelper} from './brv-e2e-helper.js'
import {getE2eConfig, requireE2eEnv} from './env-guard.js'

const dummyConfig: E2eConfig = {
  apiBaseUrl: 'http://localhost:0',
  apiKey: 'test-key',
  cogitApiBaseUrl: 'http://localhost:0',
  gitRemoteBaseUrl: 'http://localhost:0',
  llmApiBaseUrl: 'http://localhost:0',
  webAppUrl: 'http://localhost:0',
}

describe('BrvE2EHelper', () => {
  describe('mechanics', () => {
    let helper: BrvE2eHelper

    beforeEach(() => {
      helper = new BrvE2eHelper(dummyConfig)
    })

    afterEach(async () => {
      await helper.cleanup()
    })

    it('should instantiate with E2eConfig', () => {
      expect(helper).to.be.instanceOf(BrvE2eHelper)
    })

    it('should throw when accessing cwd before setup()', () => {
      expect(() => helper.cwd).to.throw('setup() must be called')
    })

    it('should create a temp directory with .brv/config.json on setup()', async () => {
      await helper.setup()

      expect(helper.cwd).to.be.a('string').that.is.not.empty
      expect(existsSync(helper.cwd)).to.be.true

      const configPath = join(helper.cwd, '.brv', 'config.json')
      expect(existsSync(configPath)).to.be.true

      const config = JSON.parse(readFileSync(configPath, 'utf8'))
      expect(config).to.deep.equal({version: '0.0.1'})
    })

    it('should remove the temp directory on cleanup()', async () => {
      await helper.setup()
      const dir = helper.cwd

      await helper.cleanup()

      expect(existsSync(dir)).to.be.false
      expect(() => helper.cwd).to.throw('setup() must be called')
    })

    it('should run all registered teardown functions during cleanup() in reverse order', async () => {
      await helper.setup()

      const order: number[] = []
      helper.onTeardown(async () => { order.push(1) })
      helper.onTeardown(async () => { order.push(2) })
      helper.onTeardown(async () => { order.push(3) })

      await helper.cleanup()

      expect(order).to.deep.equal([3, 2, 1])
    })

    it('should be safe to call cleanup() multiple times', async () => {
      await helper.setup()
      await helper.cleanup()
      await helper.cleanup() // should not throw
    })

    it('should still cleanup temp dir if a teardown throws', async () => {
      await helper.setup()
      const dir = helper.cwd

      const ran: number[] = []
      helper.onTeardown(async () => { ran.push(1) })
      helper.onTeardown(async () => { throw new Error('teardown failed') })
      helper.onTeardown(async () => { ran.push(3) })

      // cleanup should not throw despite the failing teardown
      await helper.cleanup()

      expect(existsSync(dir)).to.be.false
      expect(ran).to.deep.equal([3, 1]) // reverse order, skipping the one that threw
    })

    it('should run a CLI command and return the result', async () => {
      await helper.setup()

      const result = await helper.run('--help')

      expect(result.exitCode).to.equal(0)
      expect(result.stdout).to.include('USAGE')
      expect(result.stderr).to.be.a('string')
    })

    it('should throw when runJson() receives non-JSON output', async () => {
      await helper.setup()

      try {
        await helper.runJson('--help')
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('No valid JSON')
      }
    })
  })

  describe('auth (requires E2E env)', () => {
    before(requireE2eEnv)

    let helper: BrvE2eHelper

    beforeEach(async () => {
      const config = getE2eConfig()
      helper = new BrvE2eHelper(config)
      await helper.setup()
    })

    afterEach(async () => {
      await helper.cleanup()
    })

    it('should login with the configured API key', async () => {
      const result = await helper.login()

      // login() returns void on success, throws on failure
      expect(result).to.be.undefined
    })

    it('should logout after login', async () => {
      await helper.login()
      const result = await helper.logout()

      expect(result).to.be.undefined
    })

    it('should parse JSON response via runJson()', async () => {
      const result = await helper.runJson<{userEmail?: string}>('login', ['--api-key', getE2eConfig().apiKey])

      expect(result).to.have.property('command', 'login')
      expect(result).to.have.property('success').that.is.a('boolean')
      expect(result).to.have.property('data').that.is.an('object')
      expect(result).to.have.property('timestamp').that.is.a('string')
    })
  })
})
