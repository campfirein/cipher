import {expect} from 'chai'

import {VcBranch} from '../../../../../../src/shared/transport/events/vc-events'
import {withUnbornCurrent} from '../../../../../../src/webui/features/vc/utils/with-unborn-current'

const b = (name: string, extra: Partial<VcBranch> = {}): VcBranch => ({
  isCurrent: false,
  isRemote: false,
  name,
  ...extra,
})

describe('withUnbornCurrent', () => {
  it('returns a copy of the input when currentName is undefined', () => {
    const input = [b('main'), b('feature/x')]
    const result = withUnbornCurrent(input)

    expect(result).to.deep.equal(input)
    expect(result).to.not.equal(input)
  })

  it('returns a copy of the input when a matching local branch already exists', () => {
    const input = [b('main', {isCurrent: true}), b('feature/x')]
    const result = withUnbornCurrent(input, 'main')

    expect(result).to.deep.equal(input)
    expect(result).to.not.equal(input)
  })

  it('prepends a synthetic current branch when no local branch matches', () => {
    const input = [b('feature/x')]
    const result = withUnbornCurrent(input, 'main')

    expect(result).to.have.lengthOf(2)
    expect(result[0]).to.deep.equal({isCurrent: true, isRemote: false, name: 'main'})
    expect(result[1]).to.deep.equal(input[0])
  })

  it('synthesizes a current entry even when a remote branch shares the name', () => {
    const input = [b('main', {isRemote: true})]
    const result = withUnbornCurrent(input, 'main')

    expect(result).to.have.lengthOf(2)
    expect(result[0]).to.deep.equal({isCurrent: true, isRemote: false, name: 'main'})
    expect(result[1]).to.deep.equal(input[0])
  })

  it('synthesizes when the branches array is empty', () => {
    const result = withUnbornCurrent([], 'main')

    expect(result).to.deep.equal([{isCurrent: true, isRemote: false, name: 'main'}])
  })

  it('returns an empty array when input is empty and currentName is undefined', () => {
    const result = withUnbornCurrent([])

    expect(result).to.deep.equal([])
  })

  it('does not mutate the input array', () => {
    const input = [b('feature/x')]
    const snapshot = [...input]
    withUnbornCurrent(input, 'main')

    expect(input).to.deep.equal(snapshot)
  })
})
