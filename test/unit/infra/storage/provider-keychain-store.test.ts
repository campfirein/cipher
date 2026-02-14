import {expect} from 'chai'

import {FileProviderKeychainStore} from '../../../../src/server/infra/storage/file-provider-keychain-store'
import {
  createProviderKeychainStore,
  ProviderKeychainStore,
} from '../../../../src/server/infra/storage/provider-keychain-store'

describe('createProviderKeychainStore', () => {
  describe('environment-based selection', () => {
    it('should return FileProviderKeychainStore when shouldUseFileFn returns true', () => {
      const store = createProviderKeychainStore(() => true)
      expect(store).to.be.instanceOf(FileProviderKeychainStore)
    })

    it('should return ProviderKeychainStore when shouldUseFileFn returns false', () => {
      const store = createProviderKeychainStore(() => false)
      expect(store).to.be.instanceOf(ProviderKeychainStore)
    })
  })

  describe('default behavior', () => {
    it('should use default shouldUseFileTokenStore function when not provided', () => {
      const store = createProviderKeychainStore()
      const isFileStore = store instanceof FileProviderKeychainStore
      const isKeychainStore = store instanceof ProviderKeychainStore
      expect(isFileStore || isKeychainStore).to.be.true
    })
  })

  describe('return type', () => {
    it('should return object implementing IProviderKeychainStore interface', () => {
      const store = createProviderKeychainStore(() => false)

      expect(store).to.have.property('getApiKey').that.is.a('function')
      expect(store).to.have.property('setApiKey').that.is.a('function')
      expect(store).to.have.property('deleteApiKey').that.is.a('function')
      expect(store).to.have.property('hasApiKey').that.is.a('function')
    })
  })

  describe('FileProviderKeychainStore selection scenarios', () => {
    it('should select FileProviderKeychainStore for WSL environment', () => {
      const store = createProviderKeychainStore(() => true)
      expect(store).to.be.instanceOf(FileProviderKeychainStore)
    })

    it('should select FileProviderKeychainStore for headless Linux', () => {
      const store = createProviderKeychainStore(() => true)
      expect(store).to.be.instanceOf(FileProviderKeychainStore)
    })

    it('should select ProviderKeychainStore for desktop environments with GUI', () => {
      const store = createProviderKeychainStore(() => false)
      expect(store).to.be.instanceOf(ProviderKeychainStore)
    })
  })
})
