import {expect} from 'chai'
import {spawn as spawnChild} from 'node:child_process'
import {existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, sep} from 'node:path'

import {DAEMON_INSTANCE_FILE, HEARTBEAT_FILE} from '../../../../src/server/constants.js'
import {ensureDaemonRunning, resolveServerMainPath} from '../../../../src/server/infra/daemon/daemon-spawner.js'

describe('daemon-spawner', () => {
  let testDir: string

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-daemon-spawner-test-')))
  })

  afterEach(() => {
    try {
      rmSync(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('ensureDaemonRunning()', () => {
    it('should return immediately when daemon is already running', async () => {
      const port = 37_847
      // Simulate a running daemon: valid instance + fresh heartbeat + alive PID
      writeFileSync(
        join(testDir, DAEMON_INSTANCE_FILE),
        JSON.stringify({pid: process.pid, port, startedAt: Date.now(), version: '1.6.0'}),
      )
      writeFileSync(join(testDir, 'heartbeat'), String(Date.now()))

      const result = await ensureDaemonRunning({dataDir: testDir})

      expect(result.success).to.be.true
      if (result.success) {
        expect(result.started).to.be.false
        expect(result.info.pid).to.equal(process.pid)
        expect(result.info.port).to.equal(port)
      }
    })

    it('should wait when another client is spawning (lock held), then detect daemon', async () => {
      // Pre-acquire lock to simulate another client spawning
      writeFileSync(
        join(testDir, 'spawn.lock'),
        JSON.stringify({pid: process.pid, timestamp: Date.now()}),
      )

      // After 100ms, simulate daemon becoming ready
      setTimeout(() => {
        writeFileSync(
          join(testDir, DAEMON_INSTANCE_FILE),
          JSON.stringify({pid: process.pid, port: 37_847, startedAt: Date.now(), version: '1.6.0'}),
        )
        writeFileSync(join(testDir, 'heartbeat'), String(Date.now()))
      }, 100)

      const result = await ensureDaemonRunning({dataDir: testDir, timeoutMs: 1000})

      expect(result.success).to.be.true
      if (result.success) {
        expect(result.started).to.be.false
        expect(result.info.port).to.equal(37_847)
      }
    })

    it('should return timeout when daemon fails to start within timeout', async () => {
      // Empty dir, no daemon will appear — should timeout
      const result = await ensureDaemonRunning({dataDir: testDir, timeoutMs: 100})

      expect(result.success).to.be.false
      if (!result.success) {
        expect(result.reason).to.equal('timeout')
      }
    })

    it('should release spawn lock even when spawn times out', async () => {
      const result = await ensureDaemonRunning({dataDir: testDir, timeoutMs: 100})

      expect(result.success).to.be.false

      // spawn.lock should be cleaned up
      expect(existsSync(join(testDir, 'spawn.lock'))).to.be.false
    })

    it('should return started=false when daemon appears between discover and lock', async () => {
      // Write a lock file that is stale (dead PID) so our acquire succeeds
      // but then daemon appears on re-check
      const deadPid = 999_999_999
      writeFileSync(
        join(testDir, 'spawn.lock'),
        JSON.stringify({pid: deadPid, timestamp: Date.now()}),
      )

      // Write daemon files — these will be found on the re-check after lock acquisition
      writeFileSync(
        join(testDir, DAEMON_INSTANCE_FILE),
        JSON.stringify({pid: process.pid, port: 9850, startedAt: Date.now(), version: '1.6.0'}),
      )
      writeFileSync(join(testDir, 'heartbeat'), String(Date.now()))

      const result = await ensureDaemonRunning({dataDir: testDir})

      // Should detect running daemon on initial discover (files exist)
      expect(result.success).to.be.true
      if (result.success) {
        expect(result.started).to.be.false
        expect(result.info.port).to.equal(9850)
      }
    })

    it('should clean up stale daemon files when PID is dead', async () => {
      const deadPid = 999_999_999
      // Write stale daemon files (dead PID)
      writeFileSync(
        join(testDir, DAEMON_INSTANCE_FILE),
        JSON.stringify({pid: deadPid, port: 37_847, startedAt: Date.now(), version: '1.5.0'}),
      )
      writeFileSync(join(testDir, HEARTBEAT_FILE), String(Date.now() - 30_000))

      // Will timeout because no real daemon starts, but stale files should be cleaned
      await ensureDaemonRunning({dataDir: testDir, timeoutMs: 100})

      // Stale daemon.json and heartbeat should be cleaned up
      expect(existsSync(join(testDir, DAEMON_INSTANCE_FILE))).to.be.false
      expect(existsSync(join(testDir, HEARTBEAT_FILE))).to.be.false
    })

    it('should return immediately when version matches running daemon', async () => {
      writeFileSync(
        join(testDir, DAEMON_INSTANCE_FILE),
        JSON.stringify({pid: process.pid, port: 37_847, startedAt: Date.now(), version: '1.6.0'}),
      )
      writeFileSync(join(testDir, HEARTBEAT_FILE), String(Date.now()))

      const result = await ensureDaemonRunning({dataDir: testDir, version: '1.6.0'})

      expect(result.success).to.be.true
      if (result.success) {
        expect(result.started).to.be.false
        expect(result.info.port).to.equal(37_847)
      }
    })

    it('should kill old daemon via SIGTERM when version mismatch is detected', async function () {
      this.timeout(5000)

      // Spawn a real long-lived child process to simulate an old-version daemon
      const child = spawnChild(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
        detached: true,
        stdio: 'ignore',
      })
      const childPid = child.pid!
      child.unref()

      try {
        // Simulate old-version daemon: valid instance + fresh heartbeat
        writeFileSync(
          join(testDir, DAEMON_INSTANCE_FILE),
          JSON.stringify({pid: childPid, port: 37_847, startedAt: Date.now(), version: '1.5.0'}),
        )
        writeFileSync(join(testDir, HEARTBEAT_FILE), String(Date.now()))

        // Verify child is alive before test
        process.kill(childPid, 0)

        // ensureDaemonRunning with newer version should kill the old daemon
        const result = await ensureDaemonRunning({dataDir: testDir, timeoutMs: 100, version: '1.6.0'})

        // The old process must be dead (SIGTERM was sent)
        let isAlive = false
        try {
          process.kill(childPid, 0)
          isAlive = true
        } catch {
          isAlive = false
        }

        expect(isAlive, 'old daemon process should have been killed via SIGTERM').to.be.false

        // Stale daemon files should be cleaned up
        expect(existsSync(join(testDir, DAEMON_INSTANCE_FILE))).to.be.false
        expect(existsSync(join(testDir, HEARTBEAT_FILE))).to.be.false

        // Result is timeout because no real new daemon spawns in test — expected
        // The critical assertion is that the old process was killed
        expect(result.success).to.be.false
        if (!result.success) {
          expect(result.reason).to.equal('timeout')
        }
      } finally {
        // Safety cleanup: kill child if test fails and process is still alive
        try {
          process.kill(childPid, 'SIGKILL')
        } catch {
          /* already dead */
        }
      }
    })

    it('should kill old daemon via SIGTERM when heartbeat is stale', async function () {
      this.timeout(5000)

      // Spawn a real long-lived child process to simulate a stale-heartbeat daemon
      const child = spawnChild(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
        detached: true,
        stdio: 'ignore',
      })
      const childPid = child.pid!
      child.unref()

      try {
        // Simulate daemon with alive PID but stale heartbeat (>15s old)
        writeFileSync(
          join(testDir, DAEMON_INSTANCE_FILE),
          JSON.stringify({pid: childPid, port: 37_847, startedAt: Date.now(), version: '1.6.0'}),
        )
        writeFileSync(join(testDir, HEARTBEAT_FILE), String(Date.now() - 20_000))

        // Verify child is alive before test
        process.kill(childPid, 0)

        // ensureDaemonRunning should SIGTERM the stale daemon
        const result = await ensureDaemonRunning({dataDir: testDir, timeoutMs: 100})

        // The old process must be dead (SIGTERM was sent)
        let isAlive = false
        try {
          process.kill(childPid, 0)
          isAlive = true
        } catch {
          isAlive = false
        }

        expect(isAlive, 'stale-heartbeat daemon should have been killed via SIGTERM').to.be.false

        // Stale daemon files should be cleaned up
        expect(existsSync(join(testDir, DAEMON_INSTANCE_FILE))).to.be.false
        expect(existsSync(join(testDir, HEARTBEAT_FILE))).to.be.false

        // Result is timeout because no real new daemon spawns in test — expected
        // The critical assertion is that the old process was killed
        expect(result.success).to.be.false
        if (!result.success) {
          expect(result.reason).to.equal('timeout')
        }
      } finally {
        try {
          process.kill(childPid, 'SIGKILL')
        } catch {
          /* already dead */
        }
      }
    })

    it('should kill old daemon and detect new daemon after version upgrade', async function () {
      this.timeout(5000)

      // Spawn a real child process to simulate the old-version daemon
      const child = spawnChild(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
        detached: true,
        stdio: 'ignore',
      })
      const childPid = child.pid!
      child.unref()

      try {
        // Simulate old-version daemon
        writeFileSync(
          join(testDir, DAEMON_INSTANCE_FILE),
          JSON.stringify({pid: childPid, port: 37_847, startedAt: Date.now(), version: '1.5.0'}),
        )
        writeFileSync(join(testDir, HEARTBEAT_FILE), String(Date.now()))

        // After 150ms, simulate new daemon becoming ready (during poll phase after kill + cleanup)
        setTimeout(() => {
          writeFileSync(
            join(testDir, DAEMON_INSTANCE_FILE),
            JSON.stringify({pid: process.pid, port: 37_848, startedAt: Date.now(), version: '1.6.0'}),
          )
          writeFileSync(join(testDir, HEARTBEAT_FILE), String(Date.now()))
        }, 150)

        const result = await ensureDaemonRunning({dataDir: testDir, timeoutMs: 1000, version: '1.6.0'})

        // Old process must be dead
        let isAlive = false
        try {
          process.kill(childPid, 0)
          isAlive = true
        } catch {
          isAlive = false
        }

        expect(isAlive, 'old daemon process should have been killed').to.be.false

        // New daemon detected successfully
        expect(result.success).to.be.true
        if (result.success) {
          expect(result.info.port).to.equal(37_848)
          expect(result.started).to.be.true
        }
      } finally {
        try {
          process.kill(childPid, 'SIGKILL')
        } catch {
          /* already dead */
        }
      }
    })
  })

  describe('resolveServerMainPath()', () => {
    it('should return a path ending with server-main.js', () => {
      const path = resolveServerMainPath()
      expect(path.endsWith('server-main.js')).to.be.true
    })

    it('should resolve to dist/ directory (not src/)', () => {
      const path = resolveServerMainPath()
      // When running tests via tsx, import.meta.url points to src/
      // The function should redirect to dist/
      expect(path).to.include(`${sep}dist${sep}`)
      expect(path).to.not.include(`${sep}src${sep}`)
    })
  })
})
