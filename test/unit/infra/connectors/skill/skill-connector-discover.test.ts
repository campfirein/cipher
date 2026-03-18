import {expect} from 'chai'
import sinon, {type SinonStub} from 'sinon'

import type {IFileService} from '../../../../../src/server/core/interfaces/services/i-file-service.js'

import {
  MAIN_SKILL_FILE_NAME,
  SKILL_CONNECTOR_CONFIGS,
} from '../../../../../src/server/infra/connectors/skill/skill-connector-config.js'
import {SkillConnector} from '../../../../../src/server/infra/connectors/skill/skill-connector.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFileService(overrides: Partial<Record<keyof IFileService, SinonStub>> = {}): IFileService {
  return {
    createBackup: sinon.stub().resolves(''),
    delete: sinon.stub().resolves(),
    deleteDirectory: sinon.stub().resolves(),
    exists: sinon.stub().resolves(false),
    read: sinon.stub().resolves(''),
    replaceContent: sinon.stub().resolves(),
    write: sinon.stub().resolves(),
    ...overrides,
  } as unknown as IFileService
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillConnector — discoverInstalledTargets()', () => {
  const PROJECT_ROOT = '/fake/project'
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('returns 1 target for an agent with project-only install', async () => {
    // Claude Code has both projectPath and globalPath, so we control which exist via stub.
    const fileService = makeFileService()
    const existsStub = fileService.exists as SinonStub

    // Only project-scope SKILL.md exists
    existsStub.callsFake(async (filePath: string) => {
      if (filePath.includes(PROJECT_ROOT) && filePath.endsWith(MAIN_SKILL_FILE_NAME)) {
        return true
      }

      return false
    })

    const connector = new SkillConnector({fileService, projectRoot: PROJECT_ROOT})
    const targets = await connector.discoverInstalledTargets()

    // At least one project-scoped target
    const projectTargets = targets.filter((t) => t.scope === 'project')
    expect(projectTargets.length).to.be.greaterThan(0)

    // Every returned project target has the correct scope
    for (const t of projectTargets) {
      expect(t.scope).to.equal('project')
      expect(t.installedPath).to.include(PROJECT_ROOT)
    }
  })

  it('returns 1 target for a global-only agent (like OpenClaw)', async () => {
    // OpenClaw has projectPath: null, globalPath: '.openclaw/skills'
    const fileService = makeFileService()
    const existsStub = fileService.exists as SinonStub

    const openclawGlobalPath = SKILL_CONNECTOR_CONFIGS.OpenClaw.globalPath

    // Only global-scope SKILL.md exists for OpenClaw
    existsStub.callsFake(async (filePath: string) => {
      if (filePath.includes(openclawGlobalPath) && filePath.endsWith(MAIN_SKILL_FILE_NAME)) {
        return true
      }

      return false
    })

    const connector = new SkillConnector({fileService, projectRoot: PROJECT_ROOT})
    const targets = await connector.discoverInstalledTargets()

    const openclawTargets = targets.filter((t) => t.agent === 'OpenClaw')
    expect(openclawTargets).to.have.lengthOf(1)
    expect(openclawTargets[0].scope).to.equal('global')
  })

  it('returns 2 targets when an agent has both project AND global installs', async () => {
    // Claude Code has both projectPath (.claude/skills) and globalPath (.claude/skills)
    const fileService = makeFileService()
    const existsStub = fileService.exists as SinonStub

    // Make all SKILL.md exist everywhere — any path ending with SKILL.md
    existsStub.callsFake(async (filePath: string) => filePath.endsWith(MAIN_SKILL_FILE_NAME))

    const connector = new SkillConnector({fileService, projectRoot: PROJECT_ROOT})
    const targets = await connector.discoverInstalledTargets()

    // Claude Code should appear twice — once project, once global
    const claudeTargets = targets.filter((t) => t.agent === 'Claude Code')
    expect(claudeTargets).to.have.lengthOf(2)

    const scopes = claudeTargets.map((t) => t.scope).sort()
    expect(scopes).to.deep.equal(['global', 'project'])
  })

  it('skips agents that are not installed (no SKILL.md found)', async () => {
    const fileService = makeFileService()
    // exists always returns false — nothing is installed
    ;(fileService.exists as SinonStub).resolves(false)

    const connector = new SkillConnector({fileService, projectRoot: PROJECT_ROOT})
    const targets = await connector.discoverInstalledTargets()

    expect(targets).to.have.lengthOf(0)
  })

  it('swallows file check errors and skips the agent', async () => {
    const fileService = makeFileService()
    // exists throws for every call
    ;(fileService.exists as SinonStub).rejects(new Error('permission denied'))

    const connector = new SkillConnector({fileService, projectRoot: PROJECT_ROOT})

    // Must not throw
    const targets = await connector.discoverInstalledTargets()

    expect(targets).to.have.lengthOf(0)
  })
})
