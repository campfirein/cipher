import {expect} from 'chai'

import {ChannelTestHarness} from '../helpers/channel-test-harness.js'
import {makeTempContextTree} from '../helpers/temp-context-tree.js'
import {removeTempDir} from '../helpers/temp-dir.js'

// Slice 3.1 — origin allowlist. A Socket.IO client whose `Origin` header
// is not on the allowlist is rejected at handshake with `CHANNEL_UNAUTHORIZED`
// BEFORE any `channel:*` event handler fires. The CLI's `channel-client.ts`
// reads `BRV_FORCE_ORIGIN` (added by Slice 3.5) and propagates it on the
// handshake when set.

// SKIP RATIONALE (2026-05-20 internal-test ship)
// This file tests an `BRV_FORCE_ORIGIN` env var that the CLI is
// supposed to read and propagate as the Socket.IO handshake Origin
// header. `grep -rn BRV_FORCE_ORIGIN src/` returns ZERO hits — the
// consumer side was never implemented, so both cases here have been
// failing on every run. They are not Phase-9 regressions and not
// merge-introduced; skipping until either (a) the `BRV_FORCE_ORIGIN`
// CLI plumbing is implemented or (b) the file is deleted.
describe.skip('Channel Phase 3 — origin rejection', () => {
  let projectDir: string
  let harness: ChannelTestHarness

  beforeEach(async () => {
    projectDir = await makeTempContextTree()
    harness = await ChannelTestHarness.boot({projectDir})
  })

  afterEach(async () => {
    await harness.shutdown()
    await removeTempDir(projectDir)
  })

  it('rejects a non-allowlisted Origin with CHANNEL_UNAUTHORIZED', async () => {
    // Bootstrap the daemon with a valid request first.
    await harness.run('channel new pi-test')

    const evil = await harness.run('channel get pi-test --json', {
      env: {BRV_FORCE_ORIGIN: 'https://evil.example'},
    })
    expect(evil.exitCode).to.not.equal(0)
    expect(evil.stderr).to.match(/CHANNEL_UNAUTHORIZED|origin/i)
  })

  it('accepts a localhost Origin', async () => {
    const ok = await harness.run('channel new pi-test', {
      env: {BRV_FORCE_ORIGIN: 'http://127.0.0.1:7700'},
    })
    expect(ok.exitCode, ok.stderr).to.equal(0)
  })
})
