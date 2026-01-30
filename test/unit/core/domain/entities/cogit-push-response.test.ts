import {expect} from 'chai'

import {CogitPushResponse} from '../../../../../src/server/core/domain/entities/cogit-push-response.js'

describe('CogitPushResponse Entity', () => {
  const validSuccessResponse = {
    message: 'Commit successful',
    success: true,
  }

  const validErrorResponse = {
    message: 'Push rejected: branch has been updated',
    success: false,
  }

  describe('Constructor', () => {
    it('should create a valid CogitPushResponse instance for success', () => {
      const response = new CogitPushResponse(validSuccessResponse)

      expect(response.success).to.equal(true)
      expect(response.message).to.equal(validSuccessResponse.message)
    })

    it('should create a valid CogitPushResponse instance for error', () => {
      const response = new CogitPushResponse(validErrorResponse)

      expect(response.success).to.equal(false)
      expect(response.message).to.equal(validErrorResponse.message)
    })

    it('should allow empty message', () => {
      const response = new CogitPushResponse({
        message: '',
        success: true,
      })

      expect(response.message).to.equal('')
    })
  })

  describe('fromJson', () => {
    it('should deserialize CogitPushResponse from JSON', () => {
      const response = CogitPushResponse.fromJson(validSuccessResponse)

      expect(response.success).to.equal(true)
      expect(response.message).to.equal(validSuccessResponse.message)
    })

    it('should throw TypeError when JSON is null', () => {
      expect(() => CogitPushResponse.fromJson(null)).to.throw(
        TypeError,
        'CogitPushResponse JSON must be an object',
      )
    })

    it('should throw TypeError when JSON is not an object', () => {
      expect(() => CogitPushResponse.fromJson('string')).to.throw(
        TypeError,
        'CogitPushResponse JSON must be an object',
      )
    })

    it('should throw TypeError when success is missing', () => {
      expect(() =>
        CogitPushResponse.fromJson({
          message: 'test',
        }),
      ).to.throw(TypeError, 'CogitPushResponse JSON must have a boolean success field')
    })

    it('should throw TypeError when success is not a boolean', () => {
      expect(() =>
        CogitPushResponse.fromJson({
          message: 'test',
          success: 'true',
        }),
      ).to.throw(TypeError, 'CogitPushResponse JSON must have a boolean success field')
    })

    it('should throw TypeError when message is missing', () => {
      expect(() =>
        CogitPushResponse.fromJson({
          success: true,
        }),
      ).to.throw(TypeError, 'CogitPushResponse JSON must have a string message field')
    })

    it('should throw TypeError when message is not a string', () => {
      expect(() =>
        CogitPushResponse.fromJson({
          message: 123,
          success: true,
        }),
      ).to.throw(TypeError, 'CogitPushResponse JSON must have a string message field')
    })

    it('should deserialize error response correctly', () => {
      const apiErrorResponse = {
        message: 'Push rejected',
        success: false,
      }

      const response = CogitPushResponse.fromJson(apiErrorResponse)

      expect(response.success).to.equal(false)
      expect(response.message).to.equal('Push rejected')
    })
  })
})
