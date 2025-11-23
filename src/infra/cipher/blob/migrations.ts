import type Database from 'better-sqlite3'

/**
 * Migration definition type
 */
export type Migration = {
  /**
   * Description of what this migration does
   */
  description: string

  /**
   * Optional backward migration (downgrade)
   * Only needed for critical rollback scenarios
   * @param db - SQLite database instance
   */
  down?(db: Database.Database): void

  /**
   * Forward migration (upgrade)
   * @param db - SQLite database instance
   */
  up(db: Database.Database): void

  /**
   * Migration version number (must be sequential)
   */
  version: number
}

/**
 * SQLite Blob Storage Migrations
 *
 * IMPORTANT RULES:
 * 1. NEVER modify existing migrations - always add new ones
 * 2. Version numbers must be sequential (1, 2, 3, ...)
 * 3. Always use IF NOT EXISTS for safety
 * 4. Test migrations thoroughly before releasing
 * 5. Consider adding 'down' for complex changes
 */
export const MIGRATIONS: Migration[] = [
  {
    description: 'Initial schema: blobs table with comprehensive indexes',
    down(db) {
      // Rollback: drop all indexes and table
      db.exec(`DROP INDEX IF EXISTS idx_blobs_size_created`)
      db.exec(`DROP INDEX IF EXISTS idx_blobs_type_updated`)
      db.exec(`DROP INDEX IF EXISTS idx_blobs_created_at`)
      db.exec(`DROP INDEX IF EXISTS idx_blobs_updated_at`)
      db.exec(`DROP INDEX IF EXISTS idx_blobs_size`)
      db.exec(`DROP INDEX IF EXISTS idx_blobs_original_name`)
      db.exec(`DROP INDEX IF EXISTS idx_blobs_content_type`)
      db.exec(`DROP TABLE IF EXISTS blobs`)
    },
    up(db) {
      // Create main table
      db.exec(`
        CREATE TABLE IF NOT EXISTS blobs (
          key TEXT PRIMARY KEY,
          content BLOB NOT NULL,
          content_type TEXT,
          original_name TEXT,
          size INTEGER NOT NULL,
          tags TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)

      // Single-column indexes
      db.exec(`CREATE INDEX IF NOT EXISTS idx_blobs_content_type ON blobs(content_type)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_blobs_original_name ON blobs(original_name)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_blobs_size ON blobs(size)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_blobs_updated_at ON blobs(updated_at DESC)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_blobs_created_at ON blobs(created_at DESC)`)

      // Composite indexes
      db.exec(`CREATE INDEX IF NOT EXISTS idx_blobs_type_updated ON blobs(content_type, updated_at DESC)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_blobs_size_created ON blobs(size, created_at DESC)`)
    },
    version: 1,
  },

  // Example future migration (commented out):
  // {
  //   version: 2,
  //   description: 'Add checksum column for data integrity verification',
  //   up(db) {
  //     db.exec(`ALTER TABLE blobs ADD COLUMN checksum TEXT`);
  //     db.exec(`CREATE INDEX IF NOT EXISTS idx_blobs_checksum ON blobs(checksum)`);
  //   },
  //   down(db) {
  //     // Note: SQLite doesn't support DROP COLUMN easily
  //     // Would need to recreate table without the column
  //     db.exec(`DROP INDEX IF EXISTS idx_blobs_checksum`);
  //   },
  // },
]

/**
 * Get the current schema version from the database
 */
export function getCurrentVersion(db: Database.Database): number {
  const result = db.pragma('user_version', {simple: true}) as number
  return result
}

/**
 * Set the schema version in the database
 */
export function setVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`)
}

/**
 * Run all pending migrations
 *
 * @param db - SQLite database instance
 * @returns Number of migrations applied
 * @throws Error if migration fails
 */
export function runMigrations(db: Database.Database): number {
  const currentVersion = getCurrentVersion(db)
  const pendingMigrations = MIGRATIONS.filter((m) => m.version > currentVersion)

  if (pendingMigrations.length === 0) {
    return 0
  }

  let appliedCount = 0

  // Use transaction for atomic migrations
  const runMigrationsInTransaction = db.transaction(() => {
    for (const migration of pendingMigrations) {
      try {
        console.log(`[Migration] Applying v${migration.version}: ${migration.description}`)

        // Run the migration
        migration.up(db)

        // Update version
        setVersion(db, migration.version)

        appliedCount++
        console.log(`[Migration] ✓ Applied v${migration.version}`)
      } catch (error) {
        const errorMsg = `Migration v${migration.version} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
        console.error(`[Migration] ✗ ${errorMsg}`)
        throw new Error(errorMsg)
      }
    }
  })

  // Execute all migrations atomically
  runMigrationsInTransaction()

  return appliedCount
}

/**
 * Rollback to a specific version (use with extreme caution!)
 *
 * @param db - SQLite database instance
 * @param targetVersion - Version to rollback to
 * @throws Error if rollback fails or migrations don't have 'down' methods
 */
export function rollbackToVersion(db: Database.Database, targetVersion: number): void {
  const currentVersion = getCurrentVersion(db)

  if (targetVersion >= currentVersion) {
    throw new Error(`Cannot rollback: target version ${targetVersion} is not older than current ${currentVersion}`)
  }

  const migrationsToRollback = MIGRATIONS.filter(
    (m) => m.version > targetVersion && m.version <= currentVersion,
  ).reverse() // Rollback in reverse order

  const rollbackInTransaction = db.transaction(() => {
    for (const migration of migrationsToRollback) {
      if (!migration.down) {
        throw new Error(`Migration v${migration.version} does not support rollback (no 'down' method)`)
      }

      console.log(`[Migration] Rolling back v${migration.version}: ${migration.description}`)
      migration.down(db)
    }

    setVersion(db, targetVersion)
  })

  rollbackInTransaction()
  console.log(`[Migration] Rolled back to v${targetVersion}`)
}
