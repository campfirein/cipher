import {expect} from 'chai'
import sinon from 'sinon'

import type {ISkillExportService, SkillExportResult} from '../../../../../src/server/core/interfaces/connectors/i-skill-export-service.js'
import type {SkillKnowledgeBuilder} from '../../../../../src/server/infra/connectors/skill/skill-knowledge-builder.js'

import {SkillExportCoordinator} from '../../../../../src/server/infra/connectors/skill/skill-export-coordinator.js'

describe('SkillExportCoordinator', () => {
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('calls builder.build() and then syncInstalledTargets() with the built block', async () => {
    const builderBuild = sandbox.stub().resolves('knowledge block')
    const syncInstalledTargets = sandbox.stub().resolves({failed: [], updated: []} satisfies SkillExportResult)

    const builder = {build: builderBuild} as unknown as SkillKnowledgeBuilder
    const service = {syncInstalledTargets} as ISkillExportService

    const coordinator = new SkillExportCoordinator(builder, service)
    const result = await coordinator.buildAndSync()

    expect(builderBuild.calledOnce).to.equal(true)
    expect(syncInstalledTargets.calledOnceWithExactly('knowledge block')).to.equal(true)
    expect(syncInstalledTargets.calledAfter(builderBuild)).to.equal(true)
    expect(result).to.deep.equal({block: 'knowledge block', failed: [], updated: []})
  })

  it('syncs empty blocks so stale marker cleanup still happens', async () => {
    const builderBuild = sandbox.stub().resolves('')
    const syncInstalledTargets = sandbox.stub().resolves({failed: [], updated: []} satisfies SkillExportResult)

    const builder = {build: builderBuild} as unknown as SkillKnowledgeBuilder
    const service = {syncInstalledTargets} as ISkillExportService

    const coordinator = new SkillExportCoordinator(builder, service)
    const result = await coordinator.buildAndSync()

    expect(syncInstalledTargets.calledOnceWithExactly('')).to.equal(true)
    expect(result).to.deep.equal({block: '', failed: [], updated: []})
  })
})
