import {expect} from 'chai'

import type {E2eConfig} from './env-guard.js'

import {runBrv} from './cli-runner.js'

const dummyConfig: E2eConfig = {
  apiBaseUrl: 'http://localhost:0',
  apiKey: 'test-key',
  cogitApiBaseUrl: 'http://localhost:0',
  gitRemoteBaseUrl: 'http://localhost:0',
  llmApiBaseUrl: 'http://localhost:0',
  webAppUrl: 'http://localhost:0',
}

describe('runBrv', () => {
  it('should capture stdout from a successful command', async () => {
    const result = await runBrv({args: ['--help'], config: dummyConfig})

    expect(result.exitCode).to.equal(0)
    expect(result.stdout).to.be.a('string').and.to.include('USAGE')
    expect(result.stderr).to.be.a('string')
  })

  it('should return non-zero exit code for invalid commands without throwing', async () => {
    const result = await runBrv({args: ['nonexistent-command-xyz'], config: dummyConfig})

    expect(result.exitCode).to.not.equal(0)
    expect(result.stderr).to.be.a('string').that.is.not.empty
  })

  it('should pass command arguments correctly', async () => {
    const result = await runBrv({args: ['login', '--help'], config: dummyConfig})

    expect(result.exitCode).to.equal(0)
    expect(result.stdout).to.include('api-key')
  })

  it('should accept a custom timeout option', async () => {
    const result = await runBrv({args: ['--help'], config: dummyConfig, timeout: 30_000})

    expect(result.exitCode).to.equal(0)
    expect(result.stdout).to.include('USAGE')
  })
})
