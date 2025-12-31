import {expect} from 'chai'

import {FileTokenStore} from '../../../../src/infra/storage/file-token-store'
import {KeychainTokenStore} from '../../../../src/infra/storage/keychain-token-store'
import {createTokenStore} from '../../../../src/infra/storage/token-store'

describe('createTokenStore', () => {
  describe('platform detection', () => {
    it('should return FileTokenStore when isWSL2() returns true', () => {
      const store = createTokenStore(() => true)
      expect(store).to.be.instanceOf(FileTokenStore)
    })

    it('should return KeychainTokenStore when isWSL2() returns false', () => {
      const store = createTokenStore(() => false)
      expect(store).to.be.instanceOf(KeychainTokenStore)
    })
  })

  describe('default behavior', () => {
    it('should use default isWSL2 function when not provided', () => {
      // Default behavior - returns one of the two implementations
      const store = createTokenStore()
      const isFileStore = store instanceof FileTokenStore
      const isKeychainStore = store instanceof KeychainTokenStore
      expect(isFileStore || isKeychainStore).to.be.true
    })
  })

  describe('return type', () => {
    it('should return object implementing ITokenStore interface', () => {
      const store = createTokenStore(() => false)

      // Verify ITokenStore interface methods exist
      expect(store).to.have.property('save').that.is.a('function')
      expect(store).to.have.property('load').that.is.a('function')
      expect(store).to.have.property('clear').that.is.a('function')
    })
  })
})
