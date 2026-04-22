import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {
  HarnessContext,
  HarnessMeta,
  HarnessVersion,
} from '../../../../src/agent/core/domain/harness/types.js'

import {
  HarnessMetaSchema,
  ProjectTypeSchema,
} from '../../../../src/agent/core/domain/harness/types.js'
import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {HarnessModuleBuilder} from '../../../../src/agent/infra/harness/harness-module-builder.js'
import {
  getTemplate,
  type SupportedCommandType,
} from '../../../../src/agent/infra/harness/templates/index.js'

const SUPPORTED_COMMANDS: readonly SupportedCommandType[] = ['curate']

function makeVersion(commandType: SupportedCommandType, projectType: 'generic' | 'python' | 'typescript'): HarnessVersion {
  const template = getTemplate(commandType, projectType)
  return {
    code: template.code,
    commandType,
    createdAt: 1_700_000_000_000,
    heuristic: 0.3,
    id: `v-${commandType}-${projectType}`,
    metadata: template.meta,
    projectId: 'p',
    projectType,
    version: 1,
  }
}

describe('harness template registry (curate templates, v1.0)', () => {
  const builder = new HarnessModuleBuilder(new NoOpLogger())
  let sb: SinonSandbox

  beforeEach(() => {
    sb = createSandbox()
  })

  afterEach(() => {
    sb.restore()
  })

  describe('Test 1 — TEMPLATE_META passes HarnessMetaSchema.parse', () => {
    for (const cmd of SUPPORTED_COMMANDS) {
      for (const project of ProjectTypeSchema.options) {
        it(`${cmd}/${project} meta round-trips HarnessMetaSchema`, () => {
          const {meta} = getTemplate(cmd, project)
          expect(() => HarnessMetaSchema.parse(meta)).to.not.throw()
        })
      }
    }
  })

  describe('Test 2 — TEMPLATE_CODE loads via HarnessModuleBuilder.build', () => {
    for (const cmd of SUPPORTED_COMMANDS) {
      for (const project of ProjectTypeSchema.options) {
        it(`${cmd}/${project} code loads successfully`, () => {
          const result = builder.build(makeVersion(cmd, project))
          expect(result.loaded).to.equal(true)
          if (!result.loaded) return // unreachable: chai asserts above
          expect(typeof result.module.meta).to.equal('function')
          expect(typeof result.module.curate).to.equal('function')
        })
      }
    }
  })

  describe('Test 3 — embedded meta() equals external TEMPLATE_META', () => {
    for (const cmd of SUPPORTED_COMMANDS) {
      for (const project of ProjectTypeSchema.options) {
        it(`${cmd}/${project} embedded meta() matches TEMPLATE_META`, () => {
          const template = getTemplate(cmd, project)
          const result = builder.build(makeVersion(cmd, project))
          expect(result.loaded).to.equal(true)
          if (!result.loaded) return
          const embedded = result.module.meta()
          expect(embedded).to.deep.equal(template.meta as HarnessMeta)
        })
      }
    }
  })

  describe('Test 4 — pass-through: curate(ctx) invokes ctx.tools.curate once with ctx.env', () => {
    for (const project of ProjectTypeSchema.options) {
      it(`curate/${project} forwards ctx.env to ctx.tools.curate`, async () => {
        const result = builder.build(makeVersion('curate', project))
        expect(result.loaded).to.equal(true)
        if (!result.loaded) return
        if (result.module.curate === undefined) throw new Error('curate must be defined')

        const curateStub = sb.stub().resolves({})
        const readFileStub = sb.stub().resolves({})
        const ctx: HarnessContext = {
          abort: new AbortController().signal,
          env: {commandType: 'curate', projectType: project, workingDirectory: '/proj'},
          tools: {curate: curateStub, readFile: readFileStub},
        }

        await result.module.curate(ctx)

        expect(curateStub.callCount).to.equal(1)
        expect(curateStub.firstCall.firstArg).to.deep.equal(ctx.env)
      })
    }
  })

  describe('Test 5 — registry exhaustiveness for curate', () => {
    for (const project of ProjectTypeSchema.options) {
      it(`getTemplate('curate', '${project}') returns a defined template`, () => {
        const t = getTemplate('curate', project)
        expect(t.code).to.be.a('string').and.not.empty
        expect(t.meta).to.be.an('object')
        expect(t.meta.commandType).to.equal('curate')
      })
    }
  })

  describe('Test 6 — template body is a minimal pass-through', () => {
    // Until Phase 2's delegated-detection regex lands, verify the
    // templates STRUCTURALLY match a pass-through shape. Any reasonable
    // regex the recorder lands should match this shape; drift here
    // should fail the test before it hides in the recorder.
    const PASS_THROUGH_SHAPE = /return\s+ctx\.tools\.\w+\(/
    for (const project of ProjectTypeSchema.options) {
      it(`curate/${project} body contains a bare ctx.tools.* forward`, () => {
        const {code} = getTemplate('curate', project)
        expect(code).to.match(PASS_THROUGH_SHAPE)
      })
    }
  })
})
