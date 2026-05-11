import {expect} from 'chai'
import {join} from 'node:path'

import {channelPaths} from '../../../../../../src/server/infra/channel/storage/paths.js'

// Slice 1.3 — canonical disk layout per CHANNEL_PROTOCOL.md §4.2.
// Pure path-construction helpers; no IO. Every consumer (events-writer,
// snapshot-writer, tree-reader) builds its filesystem paths through these
// helpers so the on-disk shape stays defined in exactly one place.
describe('channelPaths', () => {
  const projectRoot = '/abs/proj'

  it('roots channels under <project>/.brv/context-tree/channel/', () => {
    expect(channelPaths.channelsRoot(projectRoot)).to.equal(
      join('/abs/proj', '.brv', 'context-tree', 'channel'),
    )
  })

  it('roots a single channel under <project>/.brv/context-tree/channel/<id>/', () => {
    expect(channelPaths.channelDir(projectRoot, 'pi-test')).to.equal(
      join('/abs/proj', '.brv', 'context-tree', 'channel', 'pi-test'),
    )
  })

  it('puts meta.json directly under the channel directory', () => {
    expect(channelPaths.metaFile(projectRoot, 'pi-test')).to.equal(
      join('/abs/proj', '.brv', 'context-tree', 'channel', 'pi-test', 'meta.json'),
    )
  })

  it('groups turn artifacts under turns/<turnId>/', () => {
    expect(channelPaths.turnDir(projectRoot, 'pi-test', '01HX')).to.equal(
      join('/abs/proj', '.brv', 'context-tree', 'channel', 'pi-test', 'turns', '01HX'),
    )
  })

  it('puts events.jsonl directly under the turn directory', () => {
    expect(channelPaths.eventsFile(projectRoot, 'pi-test', '01HX')).to.equal(
      join('/abs/proj', '.brv', 'context-tree', 'channel', 'pi-test', 'turns', '01HX', 'events.jsonl'),
    )
  })

  it('puts the per-turn snapshot at turn.json under the turn directory', () => {
    expect(channelPaths.turnSnapshotFile(projectRoot, 'pi-test', '01HX')).to.equal(
      join('/abs/proj', '.brv', 'context-tree', 'channel', 'pi-test', 'turns', '01HX', 'turn.json'),
    )
  })

  it('puts per-delivery snapshots under deliveries/<deliveryId>.json', () => {
    expect(channelPaths.deliverySnapshotFile(projectRoot, 'pi-test', '01HX', 'd-1')).to.equal(
      join('/abs/proj', '.brv', 'context-tree', 'channel', 'pi-test', 'turns', '01HX', 'deliveries', 'd-1.json'),
    )
  })

  it('puts rendered messages under messages/<deliveryId>.md', () => {
    expect(channelPaths.messageFile(projectRoot, 'pi-test', '01HX', 'd-1')).to.equal(
      join('/abs/proj', '.brv', 'context-tree', 'channel', 'pi-test', 'turns', '01HX', 'messages', 'd-1.md'),
    )
  })

  it('puts artifacts under artifacts/ (sibling of turns/)', () => {
    expect(channelPaths.artifactsDir(projectRoot, 'pi-test')).to.equal(
      join('/abs/proj', '.brv', 'context-tree', 'channel', 'pi-test', 'artifacts'),
    )
  })

  it('puts invitations under invitations/<invitationId>.json', () => {
    expect(channelPaths.invitationFile(projectRoot, 'pi-test', 'inv-1')).to.equal(
      join('/abs/proj', '.brv', 'context-tree', 'channel', 'pi-test', 'invitations', 'inv-1.json'),
    )
  })
})
