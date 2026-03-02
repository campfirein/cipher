import {expect} from 'chai'

import {buildAuthHeaders} from '../../../../src/server/infra/hub/hub-auth-headers.js'

describe('buildAuthHeaders', () => {
  describe('bearer scheme (default)', () => {
    it('should return Bearer header when authToken is provided', () => {
      const headers = buildAuthHeaders({authToken: 'my-token'})
      expect(headers).to.deep.equal({Authorization: 'Bearer my-token'})
    })

    it('should return Bearer header when authScheme is explicitly bearer', () => {
      const headers = buildAuthHeaders({authScheme: 'bearer', authToken: 'my-token'})
      expect(headers).to.deep.equal({Authorization: 'Bearer my-token'})
    })

    it('should return empty object when no token is provided', () => {
      const headers = buildAuthHeaders({authScheme: 'bearer'})
      expect(headers).to.deep.equal({})
    })
  })

  describe('token scheme', () => {
    it('should return token-prefixed Authorization header', () => {
      const headers = buildAuthHeaders({authScheme: 'token', authToken: 'ghp_abc123'})
      expect(headers).to.deep.equal({Authorization: 'token ghp_abc123'})
    })

    it('should return empty object when no token is provided', () => {
      const headers = buildAuthHeaders({authScheme: 'token'})
      expect(headers).to.deep.equal({})
    })
  })

  describe('basic scheme', () => {
    it('should return base64-encoded Basic header', () => {
      const headers = buildAuthHeaders({authScheme: 'basic', authToken: 'user:password'})
      const expectedEncoded = Buffer.from('user:password', 'utf8').toString('base64')
      expect(headers).to.deep.equal({Authorization: `Basic ${expectedEncoded}`})
    })

    it('should return empty object when no token is provided', () => {
      const headers = buildAuthHeaders({authScheme: 'basic'})
      expect(headers).to.deep.equal({})
    })
  })

  describe('custom-header scheme', () => {
    it('should return custom header with token value', () => {
      const headers = buildAuthHeaders({
        authScheme: 'custom-header',
        authToken: 'glpat-xxx',
        headerName: 'PRIVATE-TOKEN',
      })
      expect(headers).to.deep.equal({'PRIVATE-TOKEN': 'glpat-xxx'})
    })

    it('should return empty object when headerName is missing', () => {
      const headers = buildAuthHeaders({authScheme: 'custom-header', authToken: 'my-token'})
      expect(headers).to.deep.equal({})
    })

    it('should return empty object when no token is provided', () => {
      const headers = buildAuthHeaders({authScheme: 'custom-header', headerName: 'X-Auth'})
      expect(headers).to.deep.equal({})
    })
  })

  describe('none scheme', () => {
    it('should return empty object even when token is provided', () => {
      const headers = buildAuthHeaders({authScheme: 'none', authToken: 'some-token'})
      expect(headers).to.deep.equal({})
    })

    it('should return empty object with no token', () => {
      const headers = buildAuthHeaders({authScheme: 'none'})
      expect(headers).to.deep.equal({})
    })
  })

  describe('edge cases', () => {
    it('should return empty object when no params provided', () => {
      const headers = buildAuthHeaders({})
      expect(headers).to.deep.equal({})
    })
  })
})
