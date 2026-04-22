import {expect} from 'chai'

import {derivePostLoginAction} from '../../../../../src/tui/features/provider/utils/derive-post-login-action.js'

describe('derivePostLoginAction', () => {
  it('returns return-to-select-with-error when not authorized and ByteRover was selected', () => {
    const result = derivePostLoginAction({
      errorMessage: 'Authentication failed',
      isAuthorized: false,
      selectedProviderId: 'byterover',
    })

    expect(result).to.deep.equal({
      message: 'Authentication failed',
      type: 'return-to-select-with-error',
    })
  })

  it('returns return-to-select-with-error when not authorized and no provider was selected', () => {
    const result = derivePostLoginAction({
      errorMessage: 'Token exchange failed',
      isAuthorized: false,
    })

    expect(result).to.deep.equal({
      message: 'Token exchange failed',
      type: 'return-to-select-with-error',
    })
  })

  it('returns connect-byterover when authorized and ByteRover was selected', () => {
    const result = derivePostLoginAction({
      errorMessage: '',
      isAuthorized: true,
      selectedProviderId: 'byterover',
    })

    expect(result).to.deep.equal({type: 'connect-byterover'})
  })

  it('returns return-to-select when authorized but no provider was selected', () => {
    const result = derivePostLoginAction({
      errorMessage: '',
      isAuthorized: true,
    })

    expect(result).to.deep.equal({type: 'return-to-select'})
  })

  it('returns return-to-select when authorized and a non-ByteRover provider was selected', () => {
    const result = derivePostLoginAction({
      errorMessage: '',
      isAuthorized: true,
      selectedProviderId: 'openrouter',
    })

    expect(result).to.deep.equal({type: 'return-to-select'})
  })
})
