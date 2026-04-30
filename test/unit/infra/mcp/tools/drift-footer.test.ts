/**
 * Drift Footer Helper Tests
 *
 * The drift footer is appended to MCP tool text responses whenever the MCP
 * client (this process) and the running daemon are at different versions.
 * It nudges the user to restart their IDE to align versions, while leaving
 * the protocol backward-compatible during the drift window.
 */

import {expect} from 'chai'

import {appendDriftFooter} from '../../../../../src/server/infra/mcp/tools/drift-footer.js'

describe('appendDriftFooter()', () => {
  const body = 'tool result body'

  it('returns the body unchanged when versions match', () => {
    expect(appendDriftFooter(body, '3.10.0', '3.10.0')).to.equal(body)
  })

  it('returns the body unchanged when daemonVersion is undefined (older daemon)', () => {
    // Pre-fix daemons don't include daemonVersion in the register ack — the
    // footer must stay hidden so users on rolling upgrades don't see false
    // alarms before every daemon in the wild has been updated.
    expect(appendDriftFooter(body, '3.10.0')).to.equal(body)
  })

  it('appends a drift note when client and daemon versions differ', () => {
    const result = appendDriftFooter(body, '3.9.0', '3.10.0')

    expect(result).to.include(body)
    expect(result).to.include('3.9.0')
    expect(result).to.include('3.10.0')
    expect(result).to.include('Restart your IDE')
  })

  it('preserves the body verbatim before the footer separator', () => {
    const result = appendDriftFooter(body, '3.9.0', '3.10.0')

    expect(result.startsWith(body)).to.be.true
    expect(result).to.include('\n\n---\n')
  })

  it('treats prerelease and release of same numeric version as equivalent (no footer)', () => {
    // Without the semver-aware check, `3.10.0-beta.1` vs `3.10.0` would trip
    // the footer even though the SIGTERM gate considers them equal — a
    // confusing inconsistency for users on prerelease channels.
    expect(appendDriftFooter(body, '3.10.0-beta.1', '3.10.0')).to.equal(body)
    expect(appendDriftFooter(body, '3.10.0', '3.10.0-rc.5')).to.equal(body)
  })

  it('treats build metadata and release of same numeric version as equivalent (no footer)', () => {
    expect(appendDriftFooter(body, '3.10.0+sha.abc', '3.10.0')).to.equal(body)
    expect(appendDriftFooter(body, '3.10.0', '3.10.0+build.1')).to.equal(body)
  })
})
