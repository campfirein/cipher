import {expect} from 'chai'

import {isProcessRunning} from '../../../../src/agent/infra/storage/process-utils.js'

describe('process-utils', () => {
  describe('isProcessRunning', () => {
    it('should return true for current process', () => {
      const result = isProcessRunning(process.pid)
      expect(result).to.equal(true)
    })

    it('should return false for non-existent PID', () => {
      // Use a very high PID that's unlikely to exist
      const result = isProcessRunning(99_999_999)
      expect(result).to.equal(false)
    })

    it('should return true for PID 1 (init/launchd)', () => {
      // PID 1 always exists on Unix systems but we may not have permission
      // So it should return true (process exists, even if EPERM)
      const result = isProcessRunning(1)
      expect(result).to.equal(true)
    })

    describe('invalid PID validation', () => {
      it('should return null for PID 0 (process group)', () => {
        const result = isProcessRunning(0)
        expect(result).to.equal(null)
      })

      it('should return null for negative PID (dangerous!)', () => {
        // Negative PIDs would signal process groups - very dangerous
        const result = isProcessRunning(-1)
        expect(result).to.equal(null)
      })

      it('should return null for negative process group PID', () => {
        const result = isProcessRunning(-12_345)
        expect(result).to.equal(null)
      })

      it('should return null for NaN', () => {
        const result = isProcessRunning(Number.NaN)
        expect(result).to.equal(null)
      })

      it('should return null for float (non-integer)', () => {
        const result = isProcessRunning(123.456)
        expect(result).to.equal(null)
      })

      it('should return null for Infinity', () => {
        const result = isProcessRunning(Number.POSITIVE_INFINITY)
        expect(result).to.equal(null)
      })

      it('should return null for negative Infinity', () => {
        const result = isProcessRunning(Number.NEGATIVE_INFINITY)
        expect(result).to.equal(null)
      })
    })
  })
})
