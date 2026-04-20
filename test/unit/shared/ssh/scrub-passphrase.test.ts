import {expect} from 'chai'

import {scrubPassphrase} from '../../../../src/shared/ssh/scrub-passphrase.js'

describe('scrubPassphrase()', () => {
  it('redacts a non-empty passphrase to "***"', () => {
    const input = {message: 'hi', passphrase: 'supersecret'}
    const output = scrubPassphrase(input)
    expect(output.passphrase).to.equal('***')
    expect(output.message).to.equal('hi')
  })

  it('preserves all other fields unchanged', () => {
    const input = {message: 'msg', passphrase: 's', sign: true}
    const output = scrubPassphrase(input)
    expect(output).to.deep.equal({message: 'msg', passphrase: '***', sign: true})
  })

  it('returns the same reference when passphrase is undefined', () => {
    const input: {message: string; passphrase?: string} = {message: 'hi'}
    const output = scrubPassphrase(input)
    expect(output).to.equal(input)
  })

  it('returns the same reference when passphrase is the empty string', () => {
    const input = {message: 'hi', passphrase: ''}
    const output = scrubPassphrase(input)
    expect(output).to.equal(input)
  })

  it('does not mutate the input object', () => {
    const input = {message: 'hi', passphrase: 'secret'}
    scrubPassphrase(input)
    expect(input.passphrase).to.equal('secret')
  })

  it('works on shapes beyond IVcCommitRequest (generic)', () => {
    const input = {passphrase: 'x', unrelated: [1, 2, 3]}
    const output = scrubPassphrase(input)
    expect(output.passphrase).to.equal('***')
    expect(output.unrelated).to.deep.equal([1, 2, 3])
  })
})
