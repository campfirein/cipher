import {expect} from 'chai'
import sinon, {type SinonStub} from 'sinon'

import type {SkillExportTarget} from '../../../../../src/server/core/interfaces/connectors/i-skill-export-service.js'
import type {IFileService} from '../../../../../src/server/core/interfaces/services/i-file-service.js'
import type {SkillConnector} from '../../../../../src/server/infra/connectors/skill/skill-connector.js'

import {SkillExportService} from '../../../../../src/server/infra/connectors/skill/skill-export-service.js'
import {SkillKnowledgeBuilder} from '../../../../../src/server/infra/connectors/skill/skill-knowledge-builder.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFileService(overrides: Partial<Record<keyof IFileService, SinonStub>> = {}): IFileService {
  return {
    createBackup: sinon.stub().resolves(''),
    delete: sinon.stub().resolves(),
    deleteDirectory: sinon.stub().resolves(),
    exists: sinon.stub().resolves(true),
    read: sinon.stub().resolves('# Existing SKILL.md'),
    replaceContent: sinon.stub().resolves(),
    write: sinon.stub().resolves(),
    ...overrides,
  } as unknown as IFileService
}

function makeSkillConnector(targets: SkillExportTarget[]): SkillConnector {
  return {
    discoverInstalledTargets: sinon.stub().resolves(targets),
  } as unknown as SkillConnector
}

function makeBuilder(splicedContent = 'spliced output'): SkillKnowledgeBuilder {
  return {
    spliceIntoContent: sinon.stub().returns(splicedContent),
  } as unknown as SkillKnowledgeBuilder
}

const STATIC_TEMPLATE = '# Static SKILL.md template'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillExportService', () => {
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  // -------------------------------------------------------------------------
  // syncInstalledTargets — happy path
  // -------------------------------------------------------------------------

  describe('syncInstalledTargets() — full sync', () => {
    it('discovers targets, reads SKILL.md, splices, and writes — updated array populated', async () => {
      const targets: SkillExportTarget[] = [
        {agent: 'Claude Code', installedPath: '/project/.claude/skills/byterover', scope: 'project'},
        {agent: 'Cursor', installedPath: '/project/.cursor/skills/byterover', scope: 'project'},
      ]
      const fileService = makeFileService()
      const connector = makeSkillConnector(targets)
      const builder = makeBuilder('spliced content')

      const service = new SkillExportService({
        builder,
        fileService,
        skillConnector: connector,
        staticTemplate: STATIC_TEMPLATE,
      })

      const result = await service.syncInstalledTargets('knowledge block')

      expect(result.updated).to.have.lengthOf(2)
      expect(result.failed).to.have.lengthOf(0)

      expect(result.updated[0].agent).to.be.a('string')
      expect(result.updated[0].scope).to.be.a('string')

      // fileService.read called for each target
      expect((fileService.read as SinonStub).callCount).to.equal(2)

      // fileService.write called for each target
      expect((fileService.write as SinonStub).callCount).to.equal(2)

      // builder.spliceIntoContent called with existing content and knowledge block
      expect((builder.spliceIntoContent as SinonStub).callCount).to.equal(2)
      expect((builder.spliceIntoContent as SinonStub).firstCall.args[0]).to.equal('# Existing SKILL.md')
      expect((builder.spliceIntoContent as SinonStub).firstCall.args[1]).to.equal('knowledge block')
    })
  })

  // -------------------------------------------------------------------------
  // syncInstalledTargets — failure isolation
  // -------------------------------------------------------------------------

  describe('syncInstalledTargets() — failure isolation', () => {
    it('isolates per-target failures so other targets still succeed', async () => {
      const targets: SkillExportTarget[] = [
        {agent: 'Claude Code', installedPath: '/project/.claude/skills/byterover', scope: 'project'},
        {agent: 'Cursor', installedPath: '/project/.cursor/skills/byterover', scope: 'project'},
      ]

      const fileService = makeFileService()
      // First target write succeeds, second write throws
      ;(fileService.write as SinonStub)
        .onFirstCall().resolves()
        .onSecondCall().rejects(new Error('disk full'))

      const connector = makeSkillConnector(targets)
      const builder = makeBuilder('spliced')

      const service = new SkillExportService({
        builder,
        fileService,
        skillConnector: connector,
        staticTemplate: STATIC_TEMPLATE,
      })

      const result = await service.syncInstalledTargets('block')

      // One succeeded, one failed
      expect(result.updated).to.have.lengthOf(1)
      expect(result.failed).to.have.lengthOf(1)
      expect(result.failed[0].error).to.equal('disk full')
    })
  })

  // -------------------------------------------------------------------------
  // syncInstalledTargets — no targets
  // -------------------------------------------------------------------------

  describe('syncInstalledTargets() — no targets', () => {
    it('returns empty result when no targets are discovered', async () => {
      const fileService = makeFileService()
      const connector = makeSkillConnector([])
      const builder = makeBuilder()

      const service = new SkillExportService({
        builder,
        fileService,
        skillConnector: connector,
        staticTemplate: STATIC_TEMPLATE,
      })

      const result = await service.syncInstalledTargets('block')

      expect(result.updated).to.have.lengthOf(0)
      expect(result.failed).to.have.lengthOf(0)
    })
  })

  // -------------------------------------------------------------------------
  // syncInstalledTargets — empty block still writes (cleanup)
  // -------------------------------------------------------------------------

  describe('syncInstalledTargets() — empty block writes for cleanup', () => {
    it('still writes to targets even when the knowledge block is empty', async () => {
      const targets: SkillExportTarget[] = [
        {agent: 'Claude Code', installedPath: '/project/.claude/skills/byterover', scope: 'project'},
      ]
      const fileService = makeFileService()
      const connector = makeSkillConnector(targets)
      const builder = makeBuilder('cleaned up content')

      const service = new SkillExportService({
        builder,
        fileService,
        skillConnector: connector,
        staticTemplate: STATIC_TEMPLATE,
      })

      const result = await service.syncInstalledTargets('')

      expect(result.updated).to.have.lengthOf(1)
      expect((fileService.write as SinonStub).calledOnce).to.be.true
      // spliceIntoContent was called with the empty block
      expect((builder.spliceIntoContent as SinonStub).firstCall.args[1]).to.equal('')
    })
  })

  // -------------------------------------------------------------------------
  // syncInstalledTargets — static template fallback
  // -------------------------------------------------------------------------

  describe('syncInstalledTargets() — static template fallback', () => {
    it('falls back to staticTemplate when existing SKILL.md does not exist (ENOENT)', async () => {
      const targets: SkillExportTarget[] = [
        {agent: 'Claude Code', installedPath: '/project/.claude/skills/byterover', scope: 'project'},
      ]

      const fileService = makeFileService()
      // read throws ENOENT — file doesn't exist yet
      const enoentError = new Error('ENOENT: no such file or directory')
      ;(enoentError as NodeJS.ErrnoException).code = 'ENOENT'
      ;(fileService.read as SinonStub).rejects(enoentError)

      const connector = makeSkillConnector(targets)
      const builder = makeBuilder('spliced from template')

      const service = new SkillExportService({
        builder,
        fileService,
        skillConnector: connector,
        staticTemplate: STATIC_TEMPLATE,
      })

      const result = await service.syncInstalledTargets('block')

      expect(result.updated).to.have.lengthOf(1)
      expect(result.failed).to.have.lengthOf(0)

      // spliceIntoContent should have been called with the static template, not the file content
      expect((builder.spliceIntoContent as SinonStub).firstCall.args[0]).to.equal(STATIC_TEMPLATE)
    })

    it('records failure when read throws a non-ENOENT error (e.g. permission denied)', async () => {
      const targets: SkillExportTarget[] = [
        {agent: 'Claude Code', installedPath: '/project/.claude/skills/byterover', scope: 'project'},
      ]

      const fileService = makeFileService()
      const permError = new Error('EACCES: permission denied')
      ;(permError as NodeJS.ErrnoException).code = 'EACCES'
      ;(fileService.read as SinonStub).rejects(permError)

      const connector = makeSkillConnector(targets)
      const builder = makeBuilder()

      const service = new SkillExportService({
        builder,
        fileService,
        skillConnector: connector,
        staticTemplate: STATIC_TEMPLATE,
      })

      const result = await service.syncInstalledTargets('block')

      expect(result.updated).to.have.lengthOf(0)
      expect(result.failed).to.have.lengthOf(1)
      expect(result.failed[0].error).to.include('EACCES')
    })
  })
})
