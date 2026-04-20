import {expect} from 'chai'

import {
  CodeExecOutcomeSchema,
  EvaluationScenarioSchema,
  HarnessCapabilitySchema,
  HarnessMetaSchema,
  HarnessModeSchema,
  HarnessVersionSchema,
  ProjectTypeSchema,
} from '../../../../src/agent/core/domain/harness/types.js'

describe('autoharness-v2 types and schemas', () => {
  // ─── Enums ────────────────────────────────────────────────────────────────

  describe('enum schemas', () => {
    it('HarnessModeSchema accepts assisted / filter / policy', () => {
      expect(HarnessModeSchema.parse('assisted')).to.equal('assisted')
      expect(HarnessModeSchema.parse('filter')).to.equal('filter')
      expect(HarnessModeSchema.parse('policy')).to.equal('policy')
    })

    it('HarnessModeSchema rejects unknown values', () => {
      expect(() => HarnessModeSchema.parse('autonomous')).to.throw()
    })

    it('HarnessCapabilitySchema accepts the seven capabilities', () => {
      for (const c of ['discover', 'extract', 'buildOps', 'search', 'gather', 'curate', 'answer']) {
        expect(HarnessCapabilitySchema.parse(c)).to.equal(c)
      }
    })

    it('HarnessCapabilitySchema rejects unknown capabilities', () => {
      expect(() => HarnessCapabilitySchema.parse('mutate')).to.throw()
    })

    it('ProjectTypeSchema accepts typescript / python / generic', () => {
      expect(ProjectTypeSchema.parse('typescript')).to.equal('typescript')
      expect(ProjectTypeSchema.parse('python')).to.equal('python')
      expect(ProjectTypeSchema.parse('generic')).to.equal('generic')
    })

    it('ProjectTypeSchema rejects non-canonical shorthand', () => {
      expect(() => ProjectTypeSchema.parse('ts')).to.throw()
      expect(() => ProjectTypeSchema.parse('Typescript')).to.throw()
      expect(() => ProjectTypeSchema.parse('rust')).to.throw()
    })
  })

  // ─── HarnessMeta ──────────────────────────────────────────────────────────

  describe('HarnessMetaSchema', () => {
    const valid = {
      capabilities: ['discover', 'curate'] as const,
      commandType: 'curate',
      projectPatterns: ['src/**/*.ts'],
      version: 1,
    }

    it('round-trips a valid record via JSON', () => {
      const parsed = HarnessMetaSchema.parse(valid)
      const reparsed = HarnessMetaSchema.parse(structuredClone(parsed))
      expect(reparsed).to.deep.equal(parsed)
    })

    it('rejects an empty commandType', () => {
      expect(() => HarnessMetaSchema.parse({...valid, commandType: ''})).to.throw()
    })

    it('rejects non-positive version', () => {
      expect(() => HarnessMetaSchema.parse({...valid, version: 0})).to.throw()
      expect(() => HarnessMetaSchema.parse({...valid, version: -1})).to.throw()
    })

    it('rejects an unknown capability in the array', () => {
      expect(() =>
        HarnessMetaSchema.parse({...valid, capabilities: ['discover', 'mutate']}),
      ).to.throw()
    })

    it('rejects unknown extra keys (strict)', () => {
      expect(() => HarnessMetaSchema.parse({...valid, extra: 'nope'})).to.throw()
    })
  })

  // ─── HarnessVersion ───────────────────────────────────────────────────────

  describe('HarnessVersionSchema', () => {
    const valid = {
      code: 'export async function curate() {}',
      commandType: 'curate',
      createdAt: 1_700_000_000_000,
      heuristic: 0.42,
      id: 'harness-ver-p1-curate-v1',
      metadata: {
        capabilities: ['curate'] as const,
        commandType: 'curate',
        projectPatterns: ['src/**/*.ts'],
        version: 1,
      },
      projectId: 'proj-1',
      projectType: 'typescript' as const,
      version: 1,
    }

    it('round-trips a valid record via JSON', () => {
      const parsed = HarnessVersionSchema.parse(valid)
      const reparsed = HarnessVersionSchema.parse(structuredClone(parsed))
      expect(reparsed).to.deep.equal(parsed)
    })

    it('accepts an optional parentId', () => {
      const withParent = HarnessVersionSchema.parse({...valid, parentId: 'harness-ver-p1-curate-v0'})
      expect(withParent.parentId).to.equal('harness-ver-p1-curate-v0')
    })

    it('rejects heuristic above 1', () => {
      expect(() => HarnessVersionSchema.parse({...valid, heuristic: 1.5})).to.throw()
    })

    it('rejects heuristic below 0', () => {
      expect(() => HarnessVersionSchema.parse({...valid, heuristic: -0.1})).to.throw()
    })

    it('rejects non-positive version', () => {
      expect(() => HarnessVersionSchema.parse({...valid, version: 0})).to.throw()
    })

    it('rejects non-integer version', () => {
      expect(() => HarnessVersionSchema.parse({...valid, version: 1.5})).to.throw()
    })

    it('rejects unknown projectType', () => {
      expect(() => HarnessVersionSchema.parse({...valid, projectType: 'rust'})).to.throw()
    })

    it('rejects empty id / projectId / commandType', () => {
      expect(() => HarnessVersionSchema.parse({...valid, id: ''})).to.throw()
      expect(() => HarnessVersionSchema.parse({...valid, projectId: ''})).to.throw()
      expect(() => HarnessVersionSchema.parse({...valid, commandType: ''})).to.throw()
    })

    it('rejects empty code', () => {
      expect(() => HarnessVersionSchema.parse({...valid, code: ''})).to.throw()
    })

    it('rejects unknown extra keys (strict)', () => {
      expect(() => HarnessVersionSchema.parse({...valid, extra: 'nope'})).to.throw()
    })
  })

  // ─── CodeExecOutcome ──────────────────────────────────────────────────────

  describe('CodeExecOutcomeSchema', () => {
    const valid = {
      code: 'await tools.curate([])',
      commandType: 'curate',
      executionTimeMs: 128,
      id: 'out-1',
      projectId: 'proj-1',
      projectType: 'typescript' as const,
      sessionId: 'sess-1',
      success: true,
      timestamp: 1_700_000_000_000,
      usedHarness: false,
    }

    it('round-trips a minimal valid record via JSON', () => {
      const parsed = CodeExecOutcomeSchema.parse(valid)
      const reparsed = CodeExecOutcomeSchema.parse(structuredClone(parsed))
      expect(reparsed).to.deep.equal(parsed)
    })

    it('round-trips with all optional fields populated', () => {
      const full = {
        ...valid,
        curateResult: {ops: 5},
        delegated: true,
        queryResult: {answer: 'yes'},
        stderr: '',
        stdout: 'ok',
        userFeedback: 'good' as const,
      }
      const parsed = CodeExecOutcomeSchema.parse(full)
      const reparsed = CodeExecOutcomeSchema.parse(structuredClone(parsed))
      expect(reparsed).to.deep.equal(parsed)
    })

    it('userFeedback distinguishes all four states', () => {
      // undefined — never flagged (omit field)
      const undef = CodeExecOutcomeSchema.parse(valid)
      expect(undef.userFeedback).to.equal(undefined)

      // null — explicitly cleared
      const cleared = CodeExecOutcomeSchema.parse({...valid, userFeedback: null})
      expect(cleared.userFeedback).to.equal(null)

      // 'good'
      const good = CodeExecOutcomeSchema.parse({...valid, userFeedback: 'good'})
      expect(good.userFeedback).to.equal('good')

      // 'bad'
      const bad = CodeExecOutcomeSchema.parse({...valid, userFeedback: 'bad'})
      expect(bad.userFeedback).to.equal('bad')
    })

    it('userFeedback rejects unknown values', () => {
      expect(() => CodeExecOutcomeSchema.parse({...valid, userFeedback: 'meh'})).to.throw()
      expect(() => CodeExecOutcomeSchema.parse({...valid, userFeedback: 1})).to.throw()
    })

    it('rejects negative executionTimeMs', () => {
      expect(() => CodeExecOutcomeSchema.parse({...valid, executionTimeMs: -1})).to.throw()
    })

    it('rejects negative timestamp', () => {
      expect(() => CodeExecOutcomeSchema.parse({...valid, timestamp: -1})).to.throw()
    })

    it('rejects non-integer timestamp', () => {
      expect(() => CodeExecOutcomeSchema.parse({...valid, timestamp: 1.5})).to.throw()
    })

    it('rejects unknown projectType', () => {
      expect(() => CodeExecOutcomeSchema.parse({...valid, projectType: 'rust'})).to.throw()
    })

    it('rejects empty id / sessionId / projectId / commandType', () => {
      expect(() => CodeExecOutcomeSchema.parse({...valid, id: ''})).to.throw()
      expect(() => CodeExecOutcomeSchema.parse({...valid, sessionId: ''})).to.throw()
      expect(() => CodeExecOutcomeSchema.parse({...valid, projectId: ''})).to.throw()
      expect(() => CodeExecOutcomeSchema.parse({...valid, commandType: ''})).to.throw()
    })

    it('rejects empty harnessVersionId when provided', () => {
      expect(() => CodeExecOutcomeSchema.parse({...valid, harnessVersionId: ''})).to.throw()
    })

    it('round-trips with harnessVersionId populated', () => {
      const parsed = CodeExecOutcomeSchema.parse({
        ...valid,
        harnessVersionId: 'harness-ver-proj-1-curate-v3',
        usedHarness: true,
      })
      expect(parsed.harnessVersionId).to.equal('harness-ver-proj-1-curate-v3')
    })

    it('accepts fractional executionTimeMs (from performance.now)', () => {
      // executionTime = performance.now() - startTime is not guaranteed integer.
      // Schema deliberately omits .int() on this field.
      expect(() => CodeExecOutcomeSchema.parse({...valid, executionTimeMs: 12.345})).to.not.throw()
    })

    it('rejects unknown extra keys (strict)', () => {
      expect(() => CodeExecOutcomeSchema.parse({...valid, extra: 'nope'})).to.throw()
    })
  })

  // ─── EvaluationScenario ───────────────────────────────────────────────────

  describe('EvaluationScenarioSchema', () => {
    const valid = {
      code: 'await tools.curate([])',
      commandType: 'curate',
      expectedBehavior: 'Produces 5 curate operations',
      id: 'scen-1',
      projectId: 'proj-1',
      projectType: 'typescript' as const,
      taskDescription: 'Save this JWT pattern',
    }

    it('round-trips a valid record via JSON', () => {
      const parsed = EvaluationScenarioSchema.parse(valid)
      const reparsed = EvaluationScenarioSchema.parse(structuredClone(parsed))
      expect(reparsed).to.deep.equal(parsed)
    })

    it('rejects unknown projectType', () => {
      expect(() => EvaluationScenarioSchema.parse({...valid, projectType: 'rust'})).to.throw()
    })

    it('rejects empty id / projectId / commandType', () => {
      expect(() => EvaluationScenarioSchema.parse({...valid, id: ''})).to.throw()
      expect(() => EvaluationScenarioSchema.parse({...valid, projectId: ''})).to.throw()
      expect(() => EvaluationScenarioSchema.parse({...valid, commandType: ''})).to.throw()
    })

    it('rejects empty code / taskDescription / expectedBehavior', () => {
      expect(() => EvaluationScenarioSchema.parse({...valid, code: ''})).to.throw()
      expect(() => EvaluationScenarioSchema.parse({...valid, taskDescription: ''})).to.throw()
      expect(() => EvaluationScenarioSchema.parse({...valid, expectedBehavior: ''})).to.throw()
    })

    it('rejects unknown extra keys (strict)', () => {
      expect(() => EvaluationScenarioSchema.parse({...valid, extra: 'nope'})).to.throw()
    })
  })
})
