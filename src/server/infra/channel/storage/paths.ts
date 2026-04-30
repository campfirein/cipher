import os from 'node:os'
import path from 'node:path'

import type {ChannelMeta} from '../../../core/domain/channel/types.js'

export function resolveTreeRoot(scope: ChannelMeta['scope'], projectRoot: string): string {
  switch (scope) {
    case 'global': {
      return path.join(os.homedir(), '.brv', 'global-tree')
    }

    case 'isolated': {
      return path.join(os.homedir(), '.brv', 'isolated-trees')
    }

    case 'project': {
      return projectRoot
    }
  }
}

export function channelDir(meta: Pick<ChannelMeta, 'channelId' | 'treeRoot'>): string {
  return path.join(meta.treeRoot, '.brv', 'context-tree', 'channel', meta.channelId)
}

export function turnDir(meta: Pick<ChannelMeta, 'channelId' | 'treeRoot'>, turnId: string): string {
  return path.join(channelDir(meta), 'turns', turnId)
}

export function artifactDir(meta: Pick<ChannelMeta, 'channelId' | 'treeRoot'>): string {
  return path.join(channelDir(meta), 'artifacts')
}
