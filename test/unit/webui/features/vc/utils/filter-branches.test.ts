import {expect} from 'chai'

import {VcBranch} from '../../../../../../src/shared/transport/events/vc-events'
import {filterBranches} from '../../../../../../src/webui/features/vc/utils/filter-branches'

const b = (name: string, extra: Partial<VcBranch> = {}): VcBranch => ({
  isCurrent: false,
  isRemote: false,
  name,
  ...extra,
})

describe('filterBranches', () => {
  const branches: VcBranch[] = [
    b('main', {isCurrent: true}),
    b('feature/auth'),
    b('feature/login-dialog'),
    b('origin/main', {isRemote: true}),
    b('origin/feature/auth', {isRemote: true}),
  ]

  it('returns every branch when the query is empty', () => {
    expect(filterBranches(branches, '')).to.have.lengthOf(branches.length)
  })

  it('returns every branch when the query is only whitespace', () => {
    expect(filterBranches(branches, '   ')).to.have.lengthOf(branches.length)
  })

  it('matches a substring case-insensitively', () => {
    const result = filterBranches(branches, 'AUTH')
    expect(result.map((x) => x.name)).to.deep.equal(['feature/auth', 'origin/feature/auth'])
  })

  it('matches across slashes', () => {
    const result = filterBranches(branches, 'feature/login')
    expect(result.map((x) => x.name)).to.deep.equal(['feature/login-dialog'])
  })

  it('returns an empty array when no branch matches', () => {
    expect(filterBranches(branches, 'nonexistent')).to.deep.equal([])
  })

  it('does not mutate the input array', () => {
    const copy = [...branches]
    filterBranches(branches, 'auth')
    expect(branches).to.deep.equal(copy)
  })
})
