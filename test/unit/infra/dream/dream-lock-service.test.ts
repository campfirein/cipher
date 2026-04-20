import {expect} from 'chai'
import {mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {DreamLockService} from '../../../../src/server/infra/dream/dream-lock-service.js'

describe('DreamLockService', () => {
  let tempDir: string
  let service: DreamLockService

  beforeEach(async () => {
    tempDir = join(tmpdir(), `brv-dream-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tempDir, {recursive: true})
    service = new DreamLockService({baseDir: tempDir})
  })

  afterEach(async () => {
    await rm(tempDir, {force: true, recursive: true})
  })

  // ==========================================================================
  // tryAcquire
  // ==========================================================================

  describe('tryAcquire', () => {
    it('should acquire when no lock file exists', async () => {
      const result = await service.tryAcquire()
      expect(result.acquired).to.be.true
      if (result.acquired) {
        expect(result.priorMtime).to.equal(0)
      }
    })

    it('should write current PID to lock file on acquire', async () => {
      await service.tryAcquire()

      const content = await readFile(join(tempDir, 'dream.lock'), 'utf8')
      expect(content).to.equal(String(process.pid))
    })

    it('should fail to acquire when same process already holds the lock', async () => {
      const first = await service.tryAcquire()
      expect(first.acquired).to.be.true

      const second = await service.tryAcquire()
      expect(second.acquired).to.be.false
    })

    it('should acquire when lock file contains dead PID', async () => {
      // Write a PID that almost certainly doesn't exist
      await writeFile(join(tempDir, 'dream.lock'), '999999', 'utf8')

      const result = await service.tryAcquire()
      expect(result.acquired).to.be.true
    })

    it('should return priorMtime from existing lock file', async () => {
      // Create a lock file with a known mtime
      const lockPath = join(tempDir, 'dream.lock')
      await writeFile(lockPath, '999999', 'utf8')

      const statBefore = await stat(lockPath)
      const result = await service.tryAcquire()

      expect(result.acquired).to.be.true
      if (result.acquired) {
        expect(result.priorMtime).to.equal(statBefore.mtimeMs)
      }
    })

    it('should acquire when lock is stale (mtime older than threshold)', async () => {
      // Use a very short stale timeout for testing
      const shortService = new DreamLockService({baseDir: tempDir, staleTimeoutMs: 1})

      // Write lock with our own PID (alive) but stale
      const lockPath = join(tempDir, 'dream.lock')
      await writeFile(lockPath, String(process.pid), 'utf8')

      // Wait briefly for the 1ms timeout to expire
      await new Promise(resolve => {
        setTimeout(resolve, 10)
      })

      const result = await shortService.tryAcquire()
      expect(result.acquired).to.be.true
    })

    it('should fail when lock is held by live PID and not stale', async () => {
      // Write lock with current PID (definitely alive) and fresh mtime
      const lockPath = join(tempDir, 'dream.lock')
      await writeFile(lockPath, String(process.pid), 'utf8')

      // Default 30min stale timeout — lock is fresh
      const result = await service.tryAcquire()
      expect(result.acquired).to.be.false
    })
  })

  // ==========================================================================
  // release
  // ==========================================================================

  describe('release', () => {
    it('should clear PID content but keep the file', async () => {
      await service.tryAcquire()
      await service.release()

      const content = await readFile(join(tempDir, 'dream.lock'), 'utf8')
      expect(content).to.equal('')
    })

    it('should update mtime to now on release', async () => {
      await service.tryAcquire()
      const before = Date.now()
      await service.release()

      const st = await stat(join(tempDir, 'dream.lock'))
      // mtime should be >= before (within a small tolerance)
      expect(st.mtimeMs).to.be.at.least(before - 100)
    })
  })

  // ==========================================================================
  // rollback
  // ==========================================================================

  describe('rollback', () => {
    it('should delete lock file when priorMtime is 0', async () => {
      await service.tryAcquire()
      await service.rollback(0)

      try {
        await stat(join(tempDir, 'dream.lock'))
        expect.fail('lock file should be deleted')
      } catch (error: unknown) {
        expect((error as NodeJS.ErrnoException).code).to.equal('ENOENT')
      }
    })

    it('should restore mtime and clear content when priorMtime > 0', async () => {
      const targetMtime = Date.now() - 60_000 // 1 minute ago
      await service.tryAcquire()
      await service.rollback(targetMtime)

      const lockPath = join(tempDir, 'dream.lock')
      const content = await readFile(lockPath, 'utf8')
      expect(content).to.equal('')

      const st = await stat(lockPath)
      // Allow 1s tolerance for mtime precision
      expect(Math.abs(st.mtimeMs - targetMtime)).to.be.lessThan(1000)
    })

    it('should not throw when rolling back a non-existent lock', async () => {
      // Should not throw
      await service.rollback(0)
    })
  })
})
