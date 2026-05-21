/**
 * related-ref warner tests.
 *
 * The warner is read-only: it resolves each comma-separated ref in a
 * `<bv-topic related="...">` attribute against the on-disk context
 * tree and returns warnings for refs that are
 *   - broken   (neither `<ref>.html` nor `<ref>/` exists), or
 *   - ambiguous (both `<ref>.html` AND `<ref>/` exist).
 *
 * Refs resolving unambiguously to a file or folder return no warning.
 * The warner never mutates the attribute and never rejects the write.
 */

import {expect} from 'chai'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {computeRelatedWarnings} from '../../../../../../src/server/infra/render/writer/related-ref-warner.js'

async function seedFile(root: string, relPath: string): Promise<void> {
  const full = join(root, relPath)
  await mkdir(join(full, '..'), {recursive: true})
  await writeFile(full, '<bv-topic path="x" title="x"></bv-topic>', 'utf8')
}

async function seedFolder(root: string, relPath: string): Promise<void> {
  await mkdir(join(root, relPath), {recursive: true})
}

describe('related-ref warner', () => {
  let tmpRoot: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'related-warner-'))
  })

  afterEach(async () => {
    await rm(tmpRoot, {force: true, recursive: true})
  })

  describe('no warnings', () => {
    it('returns [] when relatedAttr is undefined', () => {
      const result = computeRelatedWarnings({contextTreeRoot: tmpRoot, relatedAttr: undefined})
      expect(result).to.deep.equal([])
    })

    it('returns [] for an empty string', () => {
      const result = computeRelatedWarnings({contextTreeRoot: tmpRoot, relatedAttr: ''})
      expect(result).to.deep.equal([])
    })

    it('returns [] for whitespace-only', () => {
      const result = computeRelatedWarnings({contextTreeRoot: tmpRoot, relatedAttr: '   ,  ,   '})
      expect(result).to.deep.equal([])
    })

    it('returns [] for a ref pointing at an existing file (no extension form)', async () => {
      await seedFile(tmpRoot, 'security/oauth.html')
      const result = computeRelatedWarnings({contextTreeRoot: tmpRoot, relatedAttr: '@security/oauth'})
      expect(result).to.deep.equal([])
    })

    it('returns [] for a ref pointing at an existing file (explicit .html form)', async () => {
      await seedFile(tmpRoot, 'security/oauth.html')
      const result = computeRelatedWarnings({contextTreeRoot: tmpRoot, relatedAttr: '@security/oauth.html'})
      expect(result).to.deep.equal([])
    })

    it('returns [] for a ref pointing at an existing folder', async () => {
      await seedFolder(tmpRoot, 'ops')
      const result = computeRelatedWarnings({contextTreeRoot: tmpRoot, relatedAttr: '@ops'})
      expect(result).to.deep.equal([])
    })

    it('returns [] for multiple refs that all resolve cleanly', async () => {
      await seedFile(tmpRoot, 'security/oauth.html')
      await seedFolder(tmpRoot, 'ops')
      const result = computeRelatedWarnings({
        contextTreeRoot: tmpRoot,
        relatedAttr: '@security/oauth, @ops',
      })
      expect(result).to.deep.equal([])
    })

    it('accepts refs without the leading @ (permissive parsing)', async () => {
      await seedFile(tmpRoot, 'security/oauth.html')
      const result = computeRelatedWarnings({contextTreeRoot: tmpRoot, relatedAttr: 'security/oauth'})
      expect(result).to.deep.equal([])
    })

    it('trims whitespace around comma-separated refs', async () => {
      await seedFile(tmpRoot, 'security/oauth.html')
      const result = computeRelatedWarnings({
        contextTreeRoot: tmpRoot,
        relatedAttr: '  @security/oauth  ',
      })
      expect(result).to.deep.equal([])
    })
  })

  describe('broken refs', () => {
    it('warns when neither a file nor a folder exists at the ref path', () => {
      const result = computeRelatedWarnings({
        contextTreeRoot: tmpRoot,
        relatedAttr: '@security/missing',
      })
      expect(result).to.have.lengthOf(1)
      expect(result[0]).to.include('@security/missing')
      expect(result[0].toLowerCase()).to.match(/not found|no such|does not exist|broken/)
    })

    it('emits one warning per broken ref in a multi-ref attribute', async () => {
      await seedFile(tmpRoot, 'security/oauth.html')
      const result = computeRelatedWarnings({
        contextTreeRoot: tmpRoot,
        relatedAttr: '@security/oauth, @security/missing_a, @security/missing_b',
      })
      expect(result).to.have.lengthOf(2)
      expect(result.some((w) => w.includes('@security/missing_a'))).to.equal(true)
      expect(result.some((w) => w.includes('@security/missing_b'))).to.equal(true)
    })
  })

  describe('ambiguous refs', () => {
    it('warns when both <ref>.html and <ref>/ exist', async () => {
      await seedFile(tmpRoot, 'architecture/cua_sandbox.html')
      await seedFolder(tmpRoot, 'architecture/cua_sandbox')
      const result = computeRelatedWarnings({
        contextTreeRoot: tmpRoot,
        relatedAttr: '@architecture/cua_sandbox',
      })
      expect(result).to.have.lengthOf(1)
      expect(result[0]).to.include('@architecture/cua_sandbox')
      expect(result[0].toLowerCase()).to.include('ambiguous')
    })

    it('warns on ambiguity even when the ref carries an explicit .html', async () => {
      await seedFile(tmpRoot, 'architecture/cua_sandbox.html')
      await seedFolder(tmpRoot, 'architecture/cua_sandbox')
      const result = computeRelatedWarnings({
        contextTreeRoot: tmpRoot,
        relatedAttr: '@architecture/cua_sandbox.html',
      })
      expect(result).to.have.lengthOf(1)
      expect(result[0].toLowerCase()).to.include('ambiguous')
    })
  })

  describe('safety', () => {
    it('refuses to escape the context-tree root via .. segments', () => {
      const result = computeRelatedWarnings({
        contextTreeRoot: tmpRoot,
        relatedAttr: '@../etc/passwd',
      })
      // Treated as unsafe — surfaces a warning, never touches the filesystem
      // outside the root.
      expect(result).to.have.lengthOf(1)
      expect(result[0].toLowerCase()).to.match(/unsafe|invalid|traversal/)
    })

    it('refuses a ref that is only "."', () => {
      const result = computeRelatedWarnings({
        contextTreeRoot: tmpRoot,
        relatedAttr: '@./foo',
      })
      expect(result).to.have.lengthOf(1)
      expect(result[0].toLowerCase()).to.match(/unsafe|invalid|traversal/)
    })
  })
})
