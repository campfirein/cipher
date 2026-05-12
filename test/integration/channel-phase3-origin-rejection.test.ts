import {expect} from 'chai'

import {ChannelTestHarness} from '../helpers/channel-test-harness.js'
import {makeTempContextTree} from '../helpers/temp-context-tree.js'
import {removeTempDir} from '../helpers/temp-dir.js'

// Slice 3.1 — origin allowlist. A Socket.IO client whose `Origin` header
// is not on the allowlist is rejected at handshake with `CHANNEL_UNAUTHORIZED`
// BEFORE any `channel:*` event handler fires. The CLI's `channel-client.ts`
// reads `BRV_FORCE_ORIGIN` (added by Slice 3.5) and propagates it on the
// handshake when set.

describe('Channel Phase 3 — origin rejection', () => {
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
