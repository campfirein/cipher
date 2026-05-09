/**
 * `logDaemonVersionDrift()` tests
 *
 * The MCP server emits a one-line drift notice on stderr whenever the running
 * daemon's version differs from the MCP's own. The notice MUST stay quiet for
 * prerelease / build-metadata variants of the same release, otherwise users on
 * prerelease channels see a false-positive drift log on every reconnect even
 * though the SIGTERM gate considers their daemon up-to-date.
 */

import {expect} from 'chai'
import * as sinon from 'sinon'

import {ByteRoverMcpServer} from '../../../../src/server/infra/mcp/mcp-server.js'

describe('ByteRoverMcpServer - logDaemonVersionDrift()', () => {
  let stderrWrite: sinon.SinonStub
  let server: ByteRoverMcpServer

  beforeEach(() => {
    stderrWrite = sinon.stub(process.stderr, 'write').returns(true)
    server = new ByteRoverMcpServer({version: '3.10.0', workingDirectory: process.cwd()})
  })

  afterEach(() => {
    sinon.restore()
  })

  function callDriftLog(daemonVersion: string | undefined): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(server as any).logDaemonVersionDrift(daemonVersion)
  }

  function driftLogWasEmitted(): boolean {
    return stderrWrite.getCalls().some((call) => {
      const arg = call.args[0]
      return typeof arg === 'string' && arg.includes('connected to daemon')
    })
  }

  it('does not log when daemonVersion is absent (older daemon)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, unicorn/no-useless-undefined
    ;(server as any).logDaemonVersionDrift(undefined)
    expect(driftLogWasEmitted()).to.be.false
  })

  it('does not log when daemon and MCP versions match exactly', () => {
    callDriftLog('3.10.0')
    expect(driftLogWasEmitted()).to.be.false
  })

  it('does not log for prerelease vs release of the same numeric version', () => {
    callDriftLog('3.10.0-beta.1')
    expect(driftLogWasEmitted()).to.be.false
  })

  it('does not log for build-metadata vs release of the same numeric version', () => {
    callDriftLog('3.10.0+sha.abc')
    expect(driftLogWasEmitted()).to.be.false
  })

  it('logs when daemon version is a different numeric version', () => {
    callDriftLog('3.11.0')
    expect(driftLogWasEmitted()).to.be.true
  })

  it('logs when daemon is on an older numeric version', () => {
    callDriftLog('3.9.0')
    expect(driftLogWasEmitted()).to.be.true
  })
})
