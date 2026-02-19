import {expect} from 'chai'

import {useAuthStore} from '../../../../../src/tui/features/auth/stores/auth-store.js'

describe('useAuthStore', () => {
  beforeEach(() => {
    useAuthStore.getState().reset()
  })

  describe('setState', () => {
    it('should clear brvConfig and user when isAuthorized is false', () => {
      // Setup: store has brvConfig and user from previous login
      useAuthStore.getState().setState({
        brvConfig: {spaceId: '1', spaceName: 'S', teamId: '1', teamName: 'T', version: '2'},
        isAuthorized: true,
        user: {email: 'a@b.com', hasOnboardedCli: true, id: '1'},
      })

      // Act: external logout — only isAuthorized, no brvConfig/user
      useAuthStore.getState().setState({isAuthorized: false})

      // Assert: brvConfig and user MUST be cleared
      const state = useAuthStore.getState()
      expect(state.brvConfig).to.be.null
      expect(state.user).to.be.null
      expect(state.isAuthorized).to.be.false
    })

    it('should clear brvConfig and user even when explicitly passed with isAuthorized false', () => {
      // Setup
      useAuthStore.getState().setState({
        brvConfig: {spaceId: '1', spaceName: 'S', teamId: '1', teamName: 'T', version: '2'},
        isAuthorized: true,
        user: {email: 'a@b.com', hasOnboardedCli: true, id: '1'},
      })

      // Act: logout with explicit brvConfig/user (should still clear)
      useAuthStore.getState().setState({
        brvConfig: {spaceId: '9', spaceName: 'X', teamId: '9', teamName: 'X', version: '2'},
        isAuthorized: false,
        user: {email: 'x@b.com', hasOnboardedCli: false, id: '9'},
      })

      // Assert: always null when isAuthorized=false
      const state = useAuthStore.getState()
      expect(state.brvConfig).to.be.null
      expect(state.user).to.be.null
    })

    it('should preserve brvConfig when isAuthorized is true and brvConfig is undefined', () => {
      // Setup
      const originalConfig = {spaceId: '1', spaceName: 'S', teamId: '1', teamName: 'T', version: '2'}
      useAuthStore.getState().setState({
        brvConfig: originalConfig,
        isAuthorized: true,
        user: {email: 'a@b.com', hasOnboardedCli: true, id: '1'},
      })

      // Act: partial broadcast — has user, no brvConfig
      useAuthStore.getState().setState({
        isAuthorized: true,
        user: {email: 'new@b.com', hasOnboardedCli: false, id: '2'},
      })

      // Assert: brvConfig preserved, user updated
      const state = useAuthStore.getState()
      expect(state.brvConfig).to.deep.equal(originalConfig)
      expect(state.user?.email).to.equal('new@b.com')
    })

    it('should update brvConfig when isAuthorized is true and brvConfig is provided', () => {
      // Setup
      useAuthStore.getState().setState({
        brvConfig: {spaceId: '1', spaceName: 'S', teamId: '1', teamName: 'T', version: '2'},
        isAuthorized: true,
        user: {email: 'a@b.com', hasOnboardedCli: true, id: '1'},
      })

      // Act: full update with new brvConfig
      const newConfig = {spaceId: '2', spaceName: 'S2', teamId: '2', teamName: 'T2', version: '2'}
      useAuthStore.getState().setState({
        brvConfig: newConfig,
        isAuthorized: true,
        user: {email: 'a@b.com', hasOnboardedCli: true, id: '1'},
      })

      // Assert: brvConfig updated
      expect(useAuthStore.getState().brvConfig).to.deep.equal(newConfig)
    })

    it('should set brvConfig to null when isAuthorized is true and brvConfig is explicitly null', () => {
      // Setup
      useAuthStore.getState().setState({
        brvConfig: {spaceId: '1', spaceName: 'S', teamId: '1', teamName: 'T', version: '2'},
        isAuthorized: true,
        user: {email: 'a@b.com', hasOnboardedCli: true, id: '1'},
      })

      // Act: explicit null brvConfig
      useAuthStore.getState().setState({
        brvConfig: null,
        isAuthorized: true,
      })

      // Assert: brvConfig cleared
      expect(useAuthStore.getState().brvConfig).to.be.null
    })

    it('should set isLoggingIn to false', () => {
      // Setup: isLoggingIn is true
      useAuthStore.getState().setLoggingIn(true)
      expect(useAuthStore.getState().isLoggingIn).to.be.true

      // Act
      useAuthStore.getState().setState({isAuthorized: true})

      // Assert
      expect(useAuthStore.getState().isLoggingIn).to.be.false
    })
  })
})
