import {expect} from 'chai'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {REGISTRY_FILE} from '../../../../src/server/constants.js'
import {ProjectRegistry} from '../../../../src/server/infra/project/project-registry.js'

describe('ProjectRegistry', () => {
  let testDir: string
  let projectDir: string
  let registry: ProjectRegistry

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-registry-test-')))
    // Create a real directory to use as a "project"
    projectDir = join(testDir, 'my-project')
    mkdirSync(projectDir, {recursive: true})
    registry = new ProjectRegistry({dataDir: testDir})
  })

  afterEach(() => {
    try {
      rmSync(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('register()', () => {
    it('should create per-project XDG directories', () => {
      const info = registry.register(projectDir)

      expect(existsSync(info.storagePath)).to.be.true
      expect(existsSync(join(info.storagePath, 'sessions'))).to.be.true
    })

    it('should persist to registry.json', () => {
      registry.register(projectDir)

      const registryPath = join(testDir, REGISTRY_FILE)
      expect(existsSync(registryPath)).to.be.true

      const content = readFileSync(registryPath, 'utf8')
      const parsed = JSON.parse(content)

      expect(parsed.version).to.equal(1)
      expect(typeof parsed.projects).to.equal('object')

      const resolvedPath = realpathSync(projectDir)
      expect(parsed.projects[resolvedPath]).to.not.be.undefined
      expect(parsed.projects[resolvedPath].projectPath).to.equal(resolvedPath)
      expect(parsed.projects[resolvedPath].storagePath).to.be.a('string')
      expect(parsed.projects[resolvedPath].sanitizedPath).to.be.a('string')
      expect(parsed.projects[resolvedPath].registeredAt).to.be.a('number')
    })

    it('should return valid ProjectInfo', () => {
      const info = registry.register(projectDir)

      const resolvedPath = realpathSync(projectDir)
      expect(info.projectPath).to.equal(resolvedPath)
      expect(info.sanitizedPath).to.be.a('string').and.to.have.length.greaterThan(0)
      expect(info.storagePath).to.be.a('string').and.to.have.length.greaterThan(0)
      expect(info.registeredAt).to.be.a('number').and.to.be.greaterThan(0)
    })

    it('should be idempotent — same path returns same ProjectInfo with same registeredAt', () => {
      const first = registry.register(projectDir)
      const second = registry.register(projectDir)

      expect(second.projectPath).to.equal(first.projectPath)
      expect(second.sanitizedPath).to.equal(first.sanitizedPath)
      expect(second.storagePath).to.equal(first.storagePath)
      expect(second.registeredAt).to.equal(first.registeredAt)
    })

    it('should resolve symlinks before registration', () => {
      const symlinkPath = join(testDir, 'my-symlink')
      symlinkSync(projectDir, symlinkPath)

      const infoViaSymlink = registry.register(symlinkPath)
      const infoViaDirect = registry.register(projectDir)

      // Both should resolve to the same project
      expect(infoViaSymlink.projectPath).to.equal(infoViaDirect.projectPath)
      expect(infoViaSymlink.registeredAt).to.equal(infoViaDirect.registeredAt)
    })

    it('should handle multiple projects', () => {
      const projectDir2 = join(testDir, 'other-project')
      mkdirSync(projectDir2, {recursive: true})

      const info1 = registry.register(projectDir)
      const info2 = registry.register(projectDir2)

      expect(info1.projectPath).to.not.equal(info2.projectPath)
      expect(info1.sanitizedPath).to.not.equal(info2.sanitizedPath)
      expect(info1.storagePath).to.not.equal(info2.storagePath)
    })

    it('should not leave temp files after write', () => {
      registry.register(projectDir)

      const files = readdirSync(testDir)
      const tempFiles = files.filter((f) => f.includes('.tmp.'))
      expect(tempFiles).to.have.lengthOf(0)
    })
  })

  describe('get()', () => {
    it('should return registered project by path', () => {
      const registered = registry.register(projectDir)
      const retrieved = registry.get(projectDir)

      expect(retrieved).to.not.be.undefined
      expect(retrieved!.projectPath).to.equal(registered.projectPath)
      expect(retrieved!.registeredAt).to.equal(registered.registeredAt)
    })

    it('should return undefined for unregistered path', () => {
      // Use an existing but unregistered directory (tmpdir always exists)
      const unregisteredDir = join(testDir, 'unregistered')
      mkdirSync(unregisteredDir, {recursive: true})
      const result = registry.get(unregisteredDir)
      expect(result).to.be.undefined
    })

    it('should resolve symlinks for lookup', () => {
      registry.register(projectDir)

      const symlinkPath = join(testDir, 'lookup-symlink')
      symlinkSync(projectDir, symlinkPath)

      const result = registry.get(symlinkPath)
      expect(result).to.not.be.undefined
      expect(result!.projectPath).to.equal(realpathSync(projectDir))
    })
  })

  describe('getAll()', () => {
    it('should return empty map when no projects registered', () => {
      const all = registry.getAll()
      expect(all.size).to.equal(0)
    })

    it('should return all registered projects', () => {
      const projectDir2 = join(testDir, 'project-two')
      mkdirSync(projectDir2, {recursive: true})

      registry.register(projectDir)
      registry.register(projectDir2)

      const all = registry.getAll()
      expect(all.size).to.equal(2)
    })
  })

  describe('unregister()', () => {
    it('should remove project from registry and return true', () => {
      registry.register(projectDir)
      const result = registry.unregister(projectDir)

      expect(result).to.be.true
      expect(registry.get(projectDir)).to.be.undefined
    })

    it('should return false for unknown path', () => {
      // Use an existing but unregistered directory
      const unregisteredDir = join(testDir, 'not-registered')
      mkdirSync(unregisteredDir, {recursive: true})
      const result = registry.unregister(unregisteredDir)
      expect(result).to.be.false
    })

    it('should persist removal to registry.json', () => {
      registry.register(projectDir)
      registry.unregister(projectDir)

      const registryPath = join(testDir, REGISTRY_FILE)
      const content = readFileSync(registryPath, 'utf8')
      const parsed = JSON.parse(content)

      expect(Object.keys(parsed.projects)).to.have.lengthOf(0)
    })

    it('should NOT delete XDG directories', () => {
      const {storagePath} = registry.register(projectDir)

      registry.unregister(projectDir)

      // Directories should still exist (data preservation)
      expect(existsSync(storagePath)).to.be.true
      expect(existsSync(join(storagePath, 'sessions'))).to.be.true
    })
  })

  describe('persistence', () => {
    it('should survive reload from disk', () => {
      const info = registry.register(projectDir)

      // Create a new registry instance pointing at the same dataDir
      const newRegistry = new ProjectRegistry({dataDir: testDir})

      const reloaded = newRegistry.get(projectDir)
      expect(reloaded).to.not.be.undefined
      expect(reloaded!.projectPath).to.equal(info.projectPath)
      expect(reloaded!.sanitizedPath).to.equal(info.sanitizedPath)
      expect(reloaded!.storagePath).to.equal(info.storagePath)
      expect(reloaded!.registeredAt).to.equal(info.registeredAt)
    })

    it('should handle corrupted registry.json gracefully', () => {
      const registryPath = join(testDir, REGISTRY_FILE)
      writeFileSync(registryPath, 'not valid json{{{')

      // Should not throw, starts empty
      const newRegistry = new ProjectRegistry({dataDir: testDir})
      expect(newRegistry.getAll().size).to.equal(0)
    })

    it('should handle invalid schema in registry.json gracefully', () => {
      const registryPath = join(testDir, REGISTRY_FILE)
      writeFileSync(registryPath, JSON.stringify({foo: 'bar'}))

      // Should not throw, starts empty
      const newRegistry = new ProjectRegistry({dataDir: testDir})
      expect(newRegistry.getAll().size).to.equal(0)
    })

    it('should write valid JSON to registry.json', () => {
      registry.register(projectDir)

      const registryPath = join(testDir, REGISTRY_FILE)
      const content = readFileSync(registryPath, 'utf8')

      // Should not throw — valid JSON
      const parsed = JSON.parse(content)
      expect(parsed.version).to.equal(1)
      expect(typeof parsed.projects).to.equal('object')
    })
  })
})
