import {expect} from 'chai'

import {unifiedDiff} from '../../../../src/oclif/lib/unified-diff.js'

describe('unifiedDiff', () => {
  it('1. identical inputs → empty diff, zero adds/deletes', () => {
    const result = unifiedDiff('a\nb\nc', 'a\nb\nc', 'v1', 'v2')
    expect(result.unifiedDiff).to.equal('')
    expect(result.lineAdds).to.equal(0)
    expect(result.lineDeletes).to.equal(0)
  })

  it('2. pure insertion: all new lines appear with "+" markers', () => {
    const result = unifiedDiff('', 'line-a\nline-b', 'v1', 'v2')
    expect(result.lineAdds).to.equal(2)
    expect(result.lineDeletes).to.equal(0)
    expect(result.unifiedDiff).to.include('+line-a')
    expect(result.unifiedDiff).to.include('+line-b')
  })

  it('3. pure deletion: removed lines appear with "-" markers', () => {
    const result = unifiedDiff('gone-1\ngone-2', '', 'v1', 'v2')
    expect(result.lineAdds).to.equal(0)
    expect(result.lineDeletes).to.equal(2)
    expect(result.unifiedDiff).to.include('-gone-1')
    expect(result.unifiedDiff).to.include('-gone-2')
  })

  it('4. mixed change: kept lines get " " prefix, changed get -/+', () => {
    const from = 'common\nold-line\nshared'
    const to = 'common\nnew-line\nshared'
    const result = unifiedDiff(from, to, 'v1', 'v2')
    expect(result.lineAdds).to.equal(1)
    expect(result.lineDeletes).to.equal(1)
    expect(result.unifiedDiff).to.match(/^--- v1$/m)
    expect(result.unifiedDiff).to.match(/^\+\+\+ v2$/m)
    expect(result.unifiedDiff).to.include(' common')
    expect(result.unifiedDiff).to.include('-old-line')
    expect(result.unifiedDiff).to.include('+new-line')
    expect(result.unifiedDiff).to.include(' shared')
  })

  it('5. diff header uses supplied labels', () => {
    const result = unifiedDiff('x', 'y', 'label-a', 'label-b')
    expect(result.unifiedDiff).to.include('--- label-a')
    expect(result.unifiedDiff).to.include('+++ label-b')
  })

  it('6. handles single-line inputs without trailing newlines', () => {
    const result = unifiedDiff('hello', 'world')
    expect(result.lineAdds).to.equal(1)
    expect(result.lineDeletes).to.equal(1)
    expect(result.unifiedDiff).to.include('-hello')
    expect(result.unifiedDiff).to.include('+world')
  })
})
