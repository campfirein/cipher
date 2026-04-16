import {expect} from 'chai'

import {partitionBranches} from '../../../../../../src/webui/features/vc/utils/partition-branches'

type Branch = {isCurrent: boolean; isRemote: boolean; name: string}

const b = (name: string, extra: Partial<Branch> = {}): Branch => ({
  isCurrent: false,
  isRemote: false,
  name,
  ...extra,
})

describe('partitionBranches', () => {
  it('separates local branches from remote branches', () => {
    const result = partitionBranches([
      b('main', {isCurrent: true}),
      b('feature/x'),
      b('origin/main', {isRemote: true}),
    ])

    expect(result.locals.map((x) => x.name)).to.deep.equal(['main', 'feature/x'])
    expect(result.remotesByHost.get('origin')?.map((x) => x.name)).to.deep.equal(['origin/main'])
  })

  it('groups remote branches by host (split on first slash)', () => {
    const result = partitionBranches([
      b('origin/main', {isRemote: true}),
      b('origin/feature/x', {isRemote: true}),
      b('upstream/main', {isRemote: true}),
    ])

    expect([...result.remotesByHost.keys()]).to.deep.equal(['origin', 'upstream'])
    expect(result.remotesByHost.get('origin')?.map((x) => x.name)).to.deep.equal([
      'origin/main',
      'origin/feature/x',
    ])
    expect(result.remotesByHost.get('upstream')?.map((x) => x.name)).to.deep.equal(['upstream/main'])
  })

  it('strips a refs/remotes/ prefix before grouping', () => {
    const result = partitionBranches([
      b('refs/remotes/origin/main', {isRemote: true}),
    ])

    expect(result.remotesByHost.get('origin')?.map((x) => x.name)).to.deep.equal([
      'refs/remotes/origin/main',
    ])
  })

  it('puts a remote branch without a slash into an "unknown" bucket', () => {
    const result = partitionBranches([b('HEAD', {isRemote: true})])
    expect(result.remotesByHost.get('unknown')?.map((x) => x.name)).to.deep.equal(['HEAD'])
  })

  it('preserves the input order within each bucket', () => {
    const result = partitionBranches([
      b('feature/z'),
      b('feature/a'),
      b('main'),
    ])
    expect(result.locals.map((x) => x.name)).to.deep.equal(['feature/z', 'feature/a', 'main'])
  })

  it('returns a locals-only result when there are no remotes', () => {
    const result = partitionBranches([b('main'), b('feature/x')])
    expect(result.remotesByHost.size).to.equal(0)
    expect(result.locals.map((x) => x.name)).to.deep.equal(['main', 'feature/x'])
  })
})
