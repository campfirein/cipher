import {expect} from 'chai'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import type {TurnEvent} from '../../src/shared/types/channel.js'

import {ChannelTestHarness, parseJson} from '../helpers/channel-test-harness.js'
import {makeTempContextTree} from '../helpers/temp-context-tree.js'
import {removeTempDir} from '../helpers/temp-dir.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PERM = resolve(HERE, '..', 'fixtures', 'mock-acp-permission.js')

// Slice 3.1 — daemon-restart recovery. Sequence:
//   1. Onboard a permission-requesting agent.
//   2. Mention; wait for permission_request to appear.
//   3. Kill the daemon (harness.restart) WITHOUT resolving the permission.
//   4. Run any harness.run() — spawns a fresh daemon, which on bootstrap:
//      (a) seeds the seq allocator + events-writer from on-disk events.jsonl,
//      (b) replays pending-permissions.jsonl,
//      (c) marks the affected delivery `errored`,
//      (d) finalises the turn as `completed`.
//   5. Assert the events.jsonl tail carries `delivery_state_change → errored`
//      with monotonic seq AND `turn_state_change → completed`.

describe('Channel Phase 3 — restart recovery', () => {
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

  it('marks a permission-orphaned delivery errored + completes the turn after restart', async () => {
    await harness.run(`channel onboard mock -- node ${FIXTURE_PERM}`)
    await harness.run('channel new pi-test')
    await harness.run('channel invite pi-test @mock --profile mock')

    const mention = await harness.run('channel mention pi-test "@mock please write" --no-wait --json')
    expect(mention.exitCode, mention.stderr).to.equal(0)
    const accepted = parseJson<{turn: {turnId: string}}>(mention.stdout)
    const {turnId} = accepted.turn

    // Wait for the permission_request to be persisted.
    await harness.pollForEvent('pi-test', turnId, (e) => e.kind === 'permission_request')

    // Kill the daemon WITHOUT resolving the permission.
    await harness.restart()

    // Next harness.run spawns a fresh daemon; bootstrap runs recovery.
    await harness.run('channel get pi-test --json')

    // The replayed events.jsonl must carry an errored delivery and a completed turn.
    const show = parseJson<{events: TurnEvent[]}>(
      (await harness.run(`channel show pi-test ${turnId} --json`)).stdout,
    )
    const erroredDelivery = show.events.find(
      (e): e is Extract<TurnEvent, {kind: 'delivery_state_change'}> =>
        e.kind === 'delivery_state_change' && e.to === 'errored',
    )
    const completedTurn = show.events.find(
      (e): e is Extract<TurnEvent, {kind: 'turn_state_change'}> =>
        e.kind === 'turn_state_change' && e.to === 'completed',
    )
    expect(erroredDelivery, 'recovery must emit delivery_state_change → errored').to.not.equal(undefined)
    expect(completedTurn, 'recovery must finalise the turn → completed').to.not.equal(undefined)
    expect(completedTurn!.seq).to.be.greaterThan(erroredDelivery!.seq)
  })
})
