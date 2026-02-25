import {expect} from 'chai'

import {FileTokenStore} from '../../../../src/server/infra/storage/file-token-store'
import {createTokenStore} from '../../../../src/server/infra/storage/token-store'

describe('createTokenStore', () => {
  it('should always return a FileTokenStore', () => {
    const store = createTokenStore()
    expect(store).to.be.instanceOf(FileTokenStore)
  })

  it('should return object implementing ITokenStore interface', () => {
    const store = createTokenStore()
    expect(store).to.have.property('save').that.is.a('function')
    expect(store).to.have.property('load').that.is.a('function')
    expect(store).to.have.property('clear').that.is.a('function')
  })
})
