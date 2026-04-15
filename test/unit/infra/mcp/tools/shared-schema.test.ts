import {expect} from 'chai'

import {CWD_DESCRIPTION, cwdField} from '../../../../../src/server/infra/mcp/tools/shared-schema.js'

describe('shared-schema', () => {
  describe('cwdField', () => {
    it('accepts undefined (optional)', () => {
      // eslint-disable-next-line unicorn/no-useless-undefined -- Zod safeParse requires an argument
      expect(cwdField.safeParse(undefined).success).to.be.true
    })

    it('accepts an absolute path string', () => {
      expect(cwdField.safeParse('/Users/me/project').success).to.be.true
    })

    it('has description wired to CWD_DESCRIPTION', () => {
      expect(cwdField.description).to.equal(CWD_DESCRIPTION)
    })
  })

  describe('CWD_DESCRIPTION', () => {
    it('contains the "Never guess" anti-hallucination rule', () => {
      expect(CWD_DESCRIPTION).to.include('Never guess')
    })
  })
})
