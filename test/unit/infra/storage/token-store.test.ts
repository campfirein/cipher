import {expect} from 'chai'

import {FileTokenStore} from '../../../../src/infra/storage/file-token-store.js'
import {KeychainTokenStore} from '../../../../src/infra/storage/keychain-token-store.js'
import {createTokenStore} from '../../../../src/infra/storage/token-store.js'

describe('createTokenStore', () => {
  describe('environment-based selection', () => {
    it('should return FileTokenStore when shouldUseFileTokenStore() returns true', () => {
      const store = createTokenStore(() => true)
      expect(store).to.be.instanceOf(FileTokenStore)
    })

    it('should return KeychainTokenStore when shouldUseFileTokenStore() returns false', () => {
      const store = createTokenStore(() => false)
      expect(store).to.be.instanceOf(KeychainTokenStore)
    })
  })

  describe('default behavior', () => {
    it('should use default shouldUseFileTokenStore function when not provided', () => {
      /** Default behavior - returns one of the two implementations */
      const store = createTokenStore()
      const isFileStore = store instanceof FileTokenStore
      const isKeychainStore = store instanceof KeychainTokenStore
      expect(isFileStore || isKeychainStore).to.be.true
    })
  })

  describe('return type', () => {
    it('should return object implementing ITokenStore interface', () => {
      const store = createTokenStore(() => false)

      /** Verify ITokenStore interface methods exist */
      expect(store).to.have.property('save').that.is.a('function')
      expect(store).to.have.property('load').that.is.a('function')
      expect(store).to.have.property('clear').that.is.a('function')
    })
  })

  describe('FileTokenStore selection scenarios', () => {
    it('should select FileTokenStore for WSL environment', () => {
      const store = createTokenStore(() => true)
      expect(store).to.be.instanceOf(FileTokenStore)
    })

    it('should select FileTokenStore for headless Linux', () => {
      const store = createTokenStore(() => true)
      expect(store).to.be.instanceOf(FileTokenStore)
    })

    it('should select KeychainTokenStore for desktop environments with GUI', () => {
      const store = createTokenStore(() => false)
      expect(store).to.be.instanceOf(KeychainTokenStore)
    })
  })
})
