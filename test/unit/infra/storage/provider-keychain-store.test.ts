import {expect} from 'chai'

import {FileProviderKeychainStore} from '../../../../src/server/infra/storage/file-provider-keychain-store'
import {createProviderKeychainStore} from '../../../../src/server/infra/storage/provider-keychain-store'

describe('createProviderKeychainStore', () => {
  it('should always return a FileProviderKeychainStore', () => {
    const store = createProviderKeychainStore()
    expect(store).to.be.instanceOf(FileProviderKeychainStore)
  })

  it('should return object implementing IProviderKeychainStore interface', () => {
    const store = createProviderKeychainStore()
    expect(store).to.have.property('getApiKey').that.is.a('function')
    expect(store).to.have.property('setApiKey').that.is.a('function')
    expect(store).to.have.property('deleteApiKey').that.is.a('function')
    expect(store).to.have.property('hasApiKey').that.is.a('function')
  })
})
