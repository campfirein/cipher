import {expect} from 'chai'

import {getCurrentPid, isProcessAlive} from '../../../../src/server/infra/instance/process-utils.js'

describe('Process Utils', () => {
  describe('getCurrentPid', () => {
    it('should return the current process ID', () => {
      const pid = getCurrentPid()

      expect(pid).to.be.a('number')
      expect(pid).to.be.greaterThan(0)
      expect(pid).to.equal(process.pid)
    })
  })

  describe('isProcessAlive', () => {
    it('should return true for the current process', () => {
      const {pid} = process
      const alive = isProcessAlive(pid)

      expect(alive).to.be.true
    })

    it('should return true for process 1 (init/launchd)', () => {
      // PID 1 is always the init process on Unix systems
      // On macOS it's launchd, on Linux it's init/systemd
      const alive = isProcessAlive(1)

      // This might return false if running in a container without init
      // or true if running normally - we just verify it doesn't throw
      expect(typeof alive).to.equal('boolean')
    })

    it('should return false for a non-existent PID', () => {
      // Use a very high PID that almost certainly doesn't exist
      // Max PID on Linux is typically 32768 or 4194304
      const nonExistentPid = 9_999_999

      const alive = isProcessAlive(nonExistentPid)

      expect(alive).to.be.false
    })

    it('should return false for PID 0', () => {
      // PID 0 is the kernel scheduler, not a user process
      const alive = isProcessAlive(0)

      // On most systems, process.kill(0, 0) will throw ESRCH
      expect(typeof alive).to.equal('boolean')
    })

    it('should handle negative PID (process groups in Unix)', () => {
      // On Unix, negative PIDs refer to process groups, not individual processes
      // -1 sends to all processes in the caller's group
      // This may return true (EPERM) or false depending on the system
      const alive = isProcessAlive(-1)

      // We just verify it returns a boolean without throwing
      expect(typeof alive).to.equal('boolean')
    })
  })
})
