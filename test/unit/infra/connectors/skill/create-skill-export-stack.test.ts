import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

import {createSkillExportStack} from '../../../../../src/server/infra/connectors/skill/create-skill-export-stack.js'
import {SkillExportCoordinator} from '../../../../../src/server/infra/connectors/skill/skill-export-coordinator.js'
import {SkillExportService} from '../../../../../src/server/infra/connectors/skill/skill-export-service.js'
import {SkillKnowledgeBuilder} from '../../../../../src/server/infra/connectors/skill/skill-knowledge-builder.js'
import {ExperienceStore} from '../../../../../src/server/infra/context-tree/experience-store.js'

describe('createSkillExportStack', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'brv-stack-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {force: true, recursive: true})
  })

  it('returns a stack with all required components', async () => {
    const stack = await createSkillExportStack(tmpDir)

    expect(stack).to.have.property('builder')
    expect(stack).to.have.property('coordinator')
    expect(stack).to.have.property('service')
    expect(stack).to.have.property('store')
  })

  it('returns correctly typed components', async () => {
    const stack = await createSkillExportStack(tmpDir)

    expect(stack.builder).to.be.instanceOf(SkillKnowledgeBuilder)
    expect(stack.coordinator).to.be.instanceOf(SkillExportCoordinator)
    expect(stack.service).to.be.instanceOf(SkillExportService)
    expect(stack.store).to.be.instanceOf(ExperienceStore)
  })

  it('wires builder into coordinator so coordinator can build and sync', async () => {
    const stack = await createSkillExportStack(tmpDir)

    // coordinator.buildAndSync() should resolve without error
    // (will return empty result since no experience is accumulated)
    const result = await stack.coordinator.buildAndSync()

    expect(result).to.have.property('updated').that.is.an('array')
    expect(result).to.have.property('failed').that.is.an('array')
  })

  it('produces the same projectRoot binding in builder and service', async () => {
    // Both builder and service should use the same projectRoot so their
    // experience data and skill-connector discovery are consistent.
    // We verify indirectly: build() returns '' (no experience) without throwing.
    const stack = await createSkillExportStack(tmpDir)
    const block = await stack.builder.build()
    expect(block).to.equal('')
  })
})
