import {expect} from 'chai'

import {isValidEmail} from '../../../../../../src/webui/features/vc/utils/is-valid-email'

describe('isValidEmail', () => {
  it('accepts a typical email', () => {
    expect(isValidEmail('john@byterover.dev')).to.be.true
  })

  it('accepts plus addressing and subdomains', () => {
    expect(isValidEmail('john+commits@mail.byterover.dev')).to.be.true
  })

  it('rejects strings without an @', () => {
    expect(isValidEmail('john-byterover.dev')).to.be.false
  })

  it('rejects strings without a TLD', () => {
    expect(isValidEmail('john@localhost')).to.be.false
  })

  it('rejects empty strings and whitespace', () => {
    expect(isValidEmail('')).to.be.false
    expect(isValidEmail('   ')).to.be.false
  })

  it('trims surrounding whitespace before validating', () => {
    expect(isValidEmail('  john@byterover.dev  ')).to.be.true
  })
})
