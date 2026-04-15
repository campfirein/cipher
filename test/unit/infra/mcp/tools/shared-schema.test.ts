import {expect} from 'chai'

import {cwdField} from '../../../../../src/server/infra/mcp/tools/shared-schema.js'

describe('shared-schema', () => {
  describe('cwdField', () => {
    it('accepts undefined (optional)', () => {
      expect(cwdField.safeParse().success).to.be.true
    })

    it('accepts an absolute path string', () => {
      expect(cwdField.safeParse('/Users/me/project').success).to.be.true
    })
  })
})
