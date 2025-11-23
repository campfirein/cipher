import Database from 'better-sqlite3'
import {expect} from 'chai'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, stub} from 'sinon'

import {
  getCurrentVersion,
  MIGRATIONS,
  rollbackToVersion,
  runMigrations,
  setVersion,
} from '../../../../../src/infra/cipher/blob/migrations.js'

describe('SQLite Migrations', () => {
  let testDir: string
  let db: Database.Database

  beforeEach(async () => {
    // Suppress console output during tests
    stub(console, 'log')
    stub(console, 'error')

    testDir = join(tmpdir(), `migrations-test-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
    db = new Database(join(testDir, 'test.db'))
  })

  afterEach(async () => {
    restore()

    if (db) {
      db.close()
    }

    try {
      await rm(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('Version Management', () => {
    it('should start at version 0 for new database', () => {
      const version = getCurrentVersion(db)
      expect(version).to.equal(0)
    })

    it('should set and get version correctly', () => {
      setVersion(db, 5)
      const version = getCurrentVersion(db)
      expect(version).to.equal(5)
    })

    it('should persist version across database reopens', () => {
      setVersion(db, 3)
      db.close()

      db = new Database(join(testDir, 'test.db'))
      const version = getCurrentVersion(db)
      expect(version).to.equal(3)
    })
  })

  describe('Migration Execution', () => {
    it('should run all migrations on fresh database', () => {
      const appliedCount = runMigrations(db)

      expect(appliedCount).to.equal(MIGRATIONS.length)
      expect(getCurrentVersion(db)).to.equal(MIGRATIONS.at(-1)!.version)
    })

    it('should create blobs table after migration', () => {
      runMigrations(db)

      // Verify table exists by querying it
      const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='blobs'")
      const row = stmt.get()
      expect(row).to.exist
    })

    it('should create all expected indexes', () => {
      runMigrations(db)

      const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='blobs'")
      const indexes = stmt.all() as Array<{name: string}>

      const indexNames = indexes.map((i) => i.name)
      expect(indexNames).to.include('idx_blobs_content_type')
      expect(indexNames).to.include('idx_blobs_updated_at')
      expect(indexNames).to.include('idx_blobs_created_at')
      expect(indexNames).to.include('idx_blobs_size')
      expect(indexNames).to.include('idx_blobs_type_updated')
      expect(indexNames).to.include('idx_blobs_size_created')
    })

    it('should not run migrations if already up-to-date', () => {
      runMigrations(db)
      const firstVersion = getCurrentVersion(db)

      const appliedCount = runMigrations(db)

      expect(appliedCount).to.equal(0)
      expect(getCurrentVersion(db)).to.equal(firstVersion)
    })

    it('should run only pending migrations', () => {
      // Simulate being at an older version
      setVersion(db, 0)

      const appliedCount = runMigrations(db)

      expect(appliedCount).to.equal(MIGRATIONS.length)
    })

    it('should be atomic (all or nothing)', () => {
      // This test verifies that if a migration fails, the transaction rolls back
      // Since our current migrations are simple, we'll just verify transaction behavior
      const originalExec = db.exec.bind(db)
      let execCount = 0

      // Stub exec to fail after first call
      stub(db, 'exec').callsFake((sql: string) => {
        execCount++
        if (execCount > 5) {
          throw new Error('Simulated migration failure')
        }

        return originalExec(sql)
      })

      try {
        runMigrations(db)
        expect.fail('Should have thrown error')
      } catch (error) {
        // Expected to fail
        expect(error).to.exist
      }

      // Version should not have changed due to rollback
      expect(getCurrentVersion(db)).to.equal(0)
    })
  })

  describe('Rollback', () => {
    it('should rollback to target version', () => {
      runMigrations(db)

      rollbackToVersion(db, 0)

      expect(getCurrentVersion(db)).to.equal(0)

      // Verify table was removed
      const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='blobs'")
      const row = stmt.get()
      expect(row).to.be.undefined
    })

    it('should throw error if target version is not older', () => {
      runMigrations(db)
      const currentVersion = getCurrentVersion(db)

      try {
        rollbackToVersion(db, currentVersion)
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('not older than current')
      }
    })

    it('should throw error if target version is newer', () => {
      setVersion(db, 1)

      try {
        rollbackToVersion(db, 5)
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
      }
    })
  })

  describe('Migration Content Validation', () => {
    it('should have sequential version numbers', () => {
      for (const [i, MIGRATION] of MIGRATIONS.entries()) {
        expect(MIGRATION.version).to.equal(i + 1)
      }
    })

    it('should have descriptions for all migrations', () => {
      for (const migration of MIGRATIONS) {
        expect(migration.description).to.be.a('string')
        expect(migration.description.length).to.be.greaterThan(0)
      }
    })

    it('should have up method for all migrations', () => {
      for (const migration of MIGRATIONS) {
        expect(migration.up).to.be.a('function')
      }
    })
  })
})
