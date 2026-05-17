import {expect} from 'chai'

import {formatBlockedCurationMessage, isBlockedCurationResponse} from '../../../../../src/server/utils/curate-outcome.js'

describe('curate-outcome', () => {
  it('detects blocked RLM/tooling responses', () => {
    const response =
      'The curation agent could not complete proper RLM curation because required code_exec tooling was not exposed.'

    expect(isBlockedCurationResponse(response)).to.be.true
    expect(formatBlockedCurationMessage(response)).to.include('Context curation blocked')
  })

  it('does not false-positive on successful no-op explanations about prior tooling failures', () => {
    const response =
      'No durable project context changes were needed because the note only documents a failed sandbox migration from last week.'

    expect(isBlockedCurationResponse(response)).to.be.false
  })
})
