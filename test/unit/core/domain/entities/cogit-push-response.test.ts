/* eslint-disable camelcase */
import {expect} from 'chai'

import {CogitPushResponse} from '../../../../../src/core/domain/entities/cogit-push-response.js'

describe('CogitPushResponse Entity', () => {
  const validSuccessResponse = {
    commitSha: 'abc123def456',
    message: 'Commit successful',
    success: true,
  }

  const validErrorResponse = {
    commitSha: '',
    message: 'Push rejected: branch has been updated',
    success: false,
  }

  describe('Constructor', () => {
    it('should create a valid CogitPushResponse instance for success', () => {
      const response = new CogitPushResponse(validSuccessResponse)

      expect(response.success).to.equal(true)
      expect(response.commitSha).to.equal(validSuccessResponse.commitSha)
      expect(response.message).to.equal(validSuccessResponse.message)
    })

    it('should create a valid CogitPushResponse instance for error', () => {
      const response = new CogitPushResponse(validErrorResponse)

      expect(response.success).to.equal(false)
      expect(response.commitSha).to.equal('')
      expect(response.message).to.equal(validErrorResponse.message)
    })

    it('should throw error when commitSha is empty for successful response', () => {
      expect(
        () =>
          new CogitPushResponse({
            ...validSuccessResponse,
            commitSha: '',
          }),
      ).to.throw('CogitPushResponse commitSha cannot be empty for successful response')
    })

    it('should throw error when commitSha is whitespace for successful response', () => {
      expect(
        () =>
          new CogitPushResponse({
            ...validSuccessResponse,
            commitSha: '   ',
          }),
      ).to.throw('CogitPushResponse commitSha cannot be empty for successful response')
    })

    it('should allow empty commitSha for error response', () => {
      const response = new CogitPushResponse(validErrorResponse)

      expect(response.commitSha).to.equal('')
    })

    it('should allow empty message', () => {
      const response = new CogitPushResponse({
        ...validSuccessResponse,
        message: '',
      })

      expect(response.message).to.equal('')
    })
  })

  describe('fromJson', () => {
    it('should deserialize CogitPushResponse from JSON with camelCase', () => {
      const response = CogitPushResponse.fromJson(validSuccessResponse)

      expect(response.success).to.equal(true)
      expect(response.commitSha).to.equal(validSuccessResponse.commitSha)
      expect(response.message).to.equal(validSuccessResponse.message)
    })

    it('should deserialize CogitPushResponse from JSON with snake_case (API format)', () => {
      const apiResponse = {
        commit_sha: 'abc123def456',
        message: 'Commit successful',
        success: true,
      }

      const response = CogitPushResponse.fromJson(apiResponse)

      expect(response.success).to.equal(true)
      expect(response.commitSha).to.equal('abc123def456')
      expect(response.message).to.equal('Commit successful')
    })

    it('should prefer snake_case over camelCase when both present', () => {
      const mixedResponse = {
        commit_sha: 'snake_case_sha',
        commitSha: 'camelCase-sha',
        message: 'Test',
        success: true,
      }

      const response = CogitPushResponse.fromJson(mixedResponse)

      expect(response.commitSha).to.equal('snake_case_sha')
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
          commit_sha: 'abc123',
          message: 'test',
        }),
      ).to.throw(TypeError, 'CogitPushResponse JSON must have a boolean success field')
    })

    it('should throw TypeError when success is not a boolean', () => {
      expect(() =>
        CogitPushResponse.fromJson({
          commit_sha: 'abc123',
          message: 'test',
          success: 'true',
        }),
      ).to.throw(TypeError, 'CogitPushResponse JSON must have a boolean success field')
    })

    it('should throw TypeError when commit_sha is missing', () => {
      expect(() =>
        CogitPushResponse.fromJson({
          message: 'test',
          success: true,
        }),
      ).to.throw(TypeError, 'CogitPushResponse JSON must have a string commit_sha field')
    })

    it('should throw TypeError when commit_sha is not a string', () => {
      expect(() =>
        CogitPushResponse.fromJson({
          commit_sha: 123,
          message: 'test',
          success: true,
        }),
      ).to.throw(TypeError, 'CogitPushResponse JSON must have a string commit_sha field')
    })

    it('should throw TypeError when message is missing', () => {
      expect(() =>
        CogitPushResponse.fromJson({
          commit_sha: 'abc123',
          success: true,
        }),
      ).to.throw(TypeError, 'CogitPushResponse JSON must have a string message field')
    })

    it('should throw TypeError when message is not a string', () => {
      expect(() =>
        CogitPushResponse.fromJson({
          commit_sha: 'abc123',
          message: 123,
          success: true,
        }),
      ).to.throw(TypeError, 'CogitPushResponse JSON must have a string message field')
    })

    it('should deserialize error response correctly', () => {
      const apiErrorResponse = {
        commit_sha: '',
        message: 'Push rejected',
        success: false,
      }

      const response = CogitPushResponse.fromJson(apiErrorResponse)

      expect(response.success).to.equal(false)
      expect(response.commitSha).to.equal('')
      expect(response.message).to.equal('Push rejected')
    })
  })
})
