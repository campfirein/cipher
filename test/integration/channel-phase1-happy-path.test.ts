import {expect} from 'chai'

import {
  ChannelTestHarness,
  parseJson,
} from '../helpers/channel-test-harness.js'
import {makeTempContextTree} from '../helpers/temp-context-tree.js'
import {makeTempDir, removeTempDir} from '../helpers/temp-dir.js'

/**
 * Phase 1 happy-path integration test (CHANNEL_PROTOCOL.md §3 demo).
 *
 * STATUS: red. Slice 1.1 ships only this test file plus the harness stub.
 * The test will fail at `ChannelTestHarness.boot()` until Slice 1.4 (channel
 * orchestrator + handler) and Slice 1.5 (oclif commands) land. Each
 * subsequent slice turns one or more `it()` blocks green.
 *
 * Goalposts encoded here (do not remove — these are the Phase 1 DoD §1+§5):
 *  - new → list → get → post → list-turns → show → archive end-to-end
 *  - Unauthenticated channel:* requests fail with CHANNEL_UNAUTHORIZED
 *    (canonical wire code) or its CLI alias ERR_BRV_DAEMON_NOT_INITIALISED
 *    when the token file is absent before the request is even attempted.
 */
describe('Channel Phase 1 — passive channels happy path', () => {
  let harness: ChannelTestHarness
  let projectDir: string

  beforeEach(async () => {
    projectDir = await makeTempContextTree()
    harness = await ChannelTestHarness.boot({projectDir})
  })

  afterEach(async () => {
    await harness?.shutdown()
    if (projectDir !== undefined) {
      await removeTempDir(projectDir)
    }
  })

  it('new → list → get → post → list-turns → show → archive', async () => {
    const createResult = await harness.run('channel new pi-test')
    expect(createResult.exitCode).to.equal(0)

    const listJson = parseJson<{channels: Array<{channelId: string; memberCount: number}>}>(
      (await harness.run('channel list --json')).stdout,
    )
    expect(listJson.channels).to.have.lengthOf(1)
    expect(listJson.channels[0].channelId).to.equal('pi-test')
    expect(listJson.channels[0].memberCount).to.equal(0)

    const getJson = parseJson<{channel: {channelId: string}}>(
      (await harness.run('channel get pi-test --json')).stdout,
    )
    expect(getJson.channel.channelId).to.equal('pi-test')

    const postResult = await harness.run('channel post pi-test "this is a note"')
    expect(postResult.exitCode).to.equal(0)

    const turnsJson = parseJson<{
      turns: Array<{state: string; turnId: string}>
    }>((await harness.run('channel list-turns pi-test --json')).stdout)
    expect(turnsJson.turns).to.have.lengthOf(1)
    expect(turnsJson.turns[0].state).to.equal('completed')

    const {turnId} = turnsJson.turns[0]
    const showJson = parseJson<{
      events: Array<{content?: string; kind: string}>
      turn: {state: string}
    }>((await harness.run(`channel show pi-test ${turnId} --json`)).stdout)
    expect(showJson.turn.state).to.equal('completed')
    expect(
      showJson.events.some((e) => e.kind === 'message' && e.content === 'this is a note'),
    ).to.equal(true)

    const archiveResult = await harness.run('channel archive pi-test')
    expect(archiveResult.exitCode).to.equal(0)

    const listAfter = parseJson<{channels: Array<{archivedAt?: string}>}>(
      (await harness.run('channel list --archived --json')).stdout,
    )
    expect(listAfter.channels[0].archivedAt).to.be.a('string')
  })

  // Auth-rejection canary required by Phase 1 DoD §5. Do NOT delete — proves
  // the channel-auth-middleware (Slice 1.4) actually rejects unauthenticated
  // channel:* requests, not just that the happy-path test happens to attach
  // the token via the oclif runner.
  it('rejects unauthenticated channel requests with CHANNEL_UNAUTHORIZED', async () => {
    // Point at an isolated BRV_DATA_DIR that has no daemon-auth-token file,
    // so daemon-client.ts has no token to attach on the handshake.
    const orphanDir = await makeTempDir('brv-orphan-')
    try {
      const result = await harness.run('channel new should-fail', {
        env: {BRV_DATA_DIR: orphanDir},
      })

      expect(result.exitCode).to.not.equal(0)
      expect(result.stderr).to.match(/CHANNEL_UNAUTHORIZED|DAEMON_NOT_INITIALISED/)
    } finally {
      await removeTempDir(orphanDir)
    }
  })
})
