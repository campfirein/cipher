import {join} from 'node:path'

/**
 * Canonical channel-protocol on-disk layout per CHANNEL_PROTOCOL.md §4.2.
 *
 *   <projectRoot>/.brv/context-tree/channel/<channelId>/
 *     meta.json                          (mutable; atomic rename writes)
 *     turns/<turnId>/
 *       events.jsonl                     (append-only — source of truth)
 *       turn.json                        (one-shot snapshot at terminal state)
 *       deliveries/<deliveryId>.json     (one-shot per recipient; absent for passive turns)
 *       messages/<deliveryId>.md         (rendered final message body per delivery)
 *     artifacts/<artifactId>             (files agents produced)
 *     invitations/<invitationId>.json    (pending invites)
 *
 * Every storage consumer (events-writer, snapshot-writer, tree-reader) builds
 * its filesystem paths through these helpers so the layout is defined exactly
 * once. Pure path-construction; no IO.
 */

const CHANNEL_TREE_SEGMENTS = ['.brv', 'context-tree', 'channel'] as const

export const channelPaths = {
  artifactsDir: (projectRoot: string, channelId: string): string =>
    join(projectRoot, ...CHANNEL_TREE_SEGMENTS, channelId, 'artifacts'),

  channelDir: (projectRoot: string, channelId: string): string =>
    join(projectRoot, ...CHANNEL_TREE_SEGMENTS, channelId),

  channelsRoot: (projectRoot: string): string => join(projectRoot, ...CHANNEL_TREE_SEGMENTS),

  deliverySnapshotFile: (
    projectRoot: string,
    channelId: string,
    turnId: string,
    deliveryId: string,
  ): string =>
    join(
      projectRoot,
      ...CHANNEL_TREE_SEGMENTS,
      channelId,
      'turns',
      turnId,
      'deliveries',
      `${deliveryId}.json`,
    ),

  eventsFile: (projectRoot: string, channelId: string, turnId: string): string =>
    join(projectRoot, ...CHANNEL_TREE_SEGMENTS, channelId, 'turns', turnId, 'events.jsonl'),

  invitationFile: (projectRoot: string, channelId: string, invitationId: string): string =>
    join(projectRoot, ...CHANNEL_TREE_SEGMENTS, channelId, 'invitations', `${invitationId}.json`),

  messageFile: (
    projectRoot: string,
    channelId: string,
    turnId: string,
    deliveryId: string,
  ): string =>
    join(
      projectRoot,
      ...CHANNEL_TREE_SEGMENTS,
      channelId,
      'turns',
      turnId,
      'messages',
      `${deliveryId}.md`,
    ),

  metaFile: (projectRoot: string, channelId: string): string =>
    join(projectRoot, ...CHANNEL_TREE_SEGMENTS, channelId, 'meta.json'),

  turnDir: (projectRoot: string, channelId: string, turnId: string): string =>
    join(projectRoot, ...CHANNEL_TREE_SEGMENTS, channelId, 'turns', turnId),

  turnSnapshotFile: (projectRoot: string, channelId: string, turnId: string): string =>
    join(projectRoot, ...CHANNEL_TREE_SEGMENTS, channelId, 'turns', turnId, 'turn.json'),
} as const
