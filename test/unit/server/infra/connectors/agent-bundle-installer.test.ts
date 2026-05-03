import {expect} from 'chai'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {getAgentBundle, isBundleSupported} from '../../../../../src/server/infra/connectors/agent-bundle-config.js'
import {installAgentBundle} from '../../../../../src/server/infra/connectors/agent-bundle-installer.js'

describe('agent bundle', () => {
  describe('agent-bundle-config', () => {
    it('reports Claude Code as supported', () => {
      expect(isBundleSupported('Claude Code')).to.equal(true)
    })

    it('reports skill+rules agents as supported (Cursor, Codex)', () => {
      expect(isBundleSupported('Cursor')).to.equal(true)
      expect(isBundleSupported('Codex')).to.equal(true)
    })

    it('reports rules-only / mcp-only agents as not supported', () => {
      expect(isBundleSupported('Claude Desktop')).to.equal(false)
      expect(isBundleSupported('Cline')).to.equal(false)
      expect(isBundleSupported('Augment Code')).to.equal(false)
    })

    it('returns Claude Code bundle config with the four expected artifact types', () => {
      const bundle = getAgentBundle('Claude Code')
      expect(bundle).to.not.be.undefined
      if (!bundle) return
      const types = bundle.artifacts.map((a) => a.type).sort()
      expect(types).to.deep.equal(['directive', 'onboarding-skill', 'recall-skill', 'sub-agent'])
    })

    it('returns Cursor bundle config with skill + directive artifacts (no sub-agent)', () => {
      const bundle = getAgentBundle('Cursor')
      expect(bundle).to.not.be.undefined
      if (!bundle) return
      const types = bundle.artifacts.map((a) => a.type).sort()
      expect(types).to.deep.equal(['directive', 'onboarding-skill', 'recall-skill'])
    })

    it('returns undefined for unsupported agents', () => {
      expect(getAgentBundle('Claude Desktop')).to.equal(undefined)
    })

    it('marks the onboarding-skill artifact as conditional', () => {
      const bundle = getAgentBundle('Claude Code')
      if (!bundle) throw new Error('Claude Code bundle missing')
      const onboarding = bundle.artifacts.find((a) => a.type === 'onboarding-skill')
      expect(onboarding?.conditional).to.equal('onboarding')
    })
  })

  describe('installAgentBundle', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'brv-bundle-installer-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, {force: true, recursive: true})
  })

  it('installs every artifact for Claude Code on a clean repo', async () => {
    const result = await installAgentBundle('Claude Code', tmpRoot)

    expect(existsSync(join(tmpRoot, '.claude', 'agents', 'byterover.md'))).to.equal(true)
    expect(existsSync(join(tmpRoot, '.claude', 'skills', 'byterover', 'SKILL.md'))).to.equal(true)
    expect(existsSync(join(tmpRoot, '.claude', 'skills', 'byterover-onboarding', 'SKILL.md'))).to.equal(true)
    expect(existsSync(join(tmpRoot, 'CLAUDE.md'))).to.equal(true)

    const installedTypes = result.installed.map((s) => s.artifact).sort()
    expect(installedTypes).to.deep.equal(['directive', 'onboarding-skill', 'recall-skill', 'sub-agent'])
    expect(result.skipped).to.deep.equal([])
  })

  it('writes the CLAUDE.md directive wrapped in canonical BRV markers when CLAUDE.md does not exist', async () => {
    await installAgentBundle('Claude Code', tmpRoot)
    const content = readFileSync(join(tmpRoot, 'CLAUDE.md'), 'utf8')
    expect(content).to.include('<!-- BEGIN BYTEROVER RULES -->')
    expect(content).to.include('<!-- END BYTEROVER RULES -->')
    expect(content).to.include('ByteRover')
  })

  it('preserves existing CLAUDE.md content and prepends the directive block at the top', async () => {
    const userContent = '# My Project\n\nThis is the user content that must be preserved.\n'
    writeFileSync(join(tmpRoot, 'CLAUDE.md'), userContent)

    await installAgentBundle('Claude Code', tmpRoot)
    const content = readFileSync(join(tmpRoot, 'CLAUDE.md'), 'utf8')
    expect(content).to.include('<!-- BEGIN BYTEROVER RULES -->')
    expect(content).to.include('# My Project')
    expect(content.indexOf('<!-- BEGIN BYTEROVER RULES -->')).to.be.lessThan(content.indexOf('# My Project'))
    expect(content).to.include('This is the user content that must be preserved.')
  })

  it('replaces only the directive block on re-install, leaving the rest of CLAUDE.md alone', async () => {
    const before = `<!-- BEGIN BYTEROVER RULES -->\nold directive content\n<!-- END BYTEROVER RULES -->\n\n# User content\nkeep me\n`
    writeFileSync(join(tmpRoot, 'CLAUDE.md'), before)

    await installAgentBundle('Claude Code', tmpRoot)
    const content = readFileSync(join(tmpRoot, 'CLAUDE.md'), 'utf8')
    expect(content).to.not.include('old directive content')
    expect(content).to.include('# User content\nkeep me')
    expect(content).to.include('<!-- BEGIN BYTEROVER RULES -->')
  })

  it('skips conditional onboarding-skill when skipped-marker exists', async () => {
    mkdirSync(join(tmpRoot, '.brv'), {recursive: true})
    writeFileSync(join(tmpRoot, '.brv', 'onboarding-skipped'), '')

    const result = await installAgentBundle('Claude Code', tmpRoot)

    expect(result.installed.map((s) => s.artifact).sort()).to.deep.equal([
      'directive',
      'recall-skill',
      'sub-agent',
    ])
    expect(result.skipped).to.have.lengthOf(1)
    expect(result.skipped[0]).to.deep.include({artifact: 'onboarding-skill', reason: 'skipped-marker'})
  })

  it('skips conditional onboarding-skill when completed-marker exists', async () => {
    mkdirSync(join(tmpRoot, '.brv'), {recursive: true})
    writeFileSync(join(tmpRoot, '.brv', 'onboarding-completed'), '')

    const result = await installAgentBundle('Claude Code', tmpRoot)

    expect(result.skipped[0]).to.deep.include({artifact: 'onboarding-skill', reason: 'completed-marker'})
  })

  it('skips conditional onboarding-skill when target file already exists (mid-flight)', async () => {
    mkdirSync(join(tmpRoot, '.claude', 'skills', 'byterover-onboarding'), {recursive: true})
    writeFileSync(join(tmpRoot, '.claude', 'skills', 'byterover-onboarding', 'SKILL.md'), 'in-progress')

    const result = await installAgentBundle('Claude Code', tmpRoot)

    expect(result.skipped[0]).to.deep.include({artifact: 'onboarding-skill', reason: 'already-exists'})
    const content = readFileSync(join(tmpRoot, '.claude', 'skills', 'byterover-onboarding', 'SKILL.md'), 'utf8')
    expect(content).to.equal('in-progress')
  })

  it('overwrites permanent artifacts (sub-agent, recall-skill) for drift correction', async () => {
    mkdirSync(join(tmpRoot, '.claude', 'agents'), {recursive: true})
    writeFileSync(join(tmpRoot, '.claude', 'agents', 'byterover.md'), 'OLD_DRIFTED_xyz')

    await installAgentBundle('Claude Code', tmpRoot)

    const content = readFileSync(join(tmpRoot, '.claude', 'agents', 'byterover.md'), 'utf8')
    expect(content).to.not.include('OLD_DRIFTED_xyz')
    expect(content).to.include('name: byterover')
  })

  it('throws when called for an unsupported agent', async () => {
    let thrown: Error | undefined
    try {
      await installAgentBundle('Claude Desktop', tmpRoot)
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown).to.not.be.undefined
    expect(thrown?.message).to.include('Claude Desktop')
  })

  it('returns absolute paths for installed artifacts', async () => {
    const result = await installAgentBundle('Claude Code', tmpRoot)
    for (const step of result.installed) {
      expect(step.path.startsWith(tmpRoot), `expected ${step.path} to start with ${tmpRoot}`).to.equal(true)
    }
  })

  it('substitutes {{var:name}} placeholders in onboarding-skill content from templateVars', async () => {
    await installAgentBundle('Claude Code', tmpRoot)
    const content = readFileSync(
      join(tmpRoot, '.claude', 'skills', 'byterover-onboarding', 'SKILL.md'),
      'utf8',
    )
    expect(content).to.not.include('{{var:')
    expect(content).to.include('.claude/skills/byterover-onboarding/')
  })
  })
})
