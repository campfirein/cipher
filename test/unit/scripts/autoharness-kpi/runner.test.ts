import {expect} from 'chai'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {
  ArmResult,
  Fixture,
  FixtureTask,
  KpiLlmClient,
  KpiReport,
} from '../../../../scripts/autoharness-kpi/runner.js'

import {
  computeKpiReport,
  exitCodeForReport,
  loadFixture,
  main,
  makeStubLlmClient,
  parseArgs,
  runArm,
  SHIP_GATE_DELTA,
} from '../../../../scripts/autoharness-kpi/runner.js'

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const REPO_FIXTURE_PATH = 'scripts/autoharness-kpi/fixture-tasks.json'

function makeFixture(tasks: FixtureTask[]): Fixture {
  return {
    commandType: 'curate',
    fixtureVersion: 'test-1',
    targetModel: 'stub',
    tasks,
  }
}

function makeArmResult(
  arm: 'harness' | 'raw',
  taskIds: readonly string[],
  rate: number,
  runs: number,
): ArmResult {
  const perTask = taskIds.map((id) => {
    const successes = Math.round(rate * runs)
    const runsResult: boolean[] = []
    for (let i = 0; i < runs; i++) runsResult.push(i < successes)
    return {runs: runsResult, successRate: rate, taskId: id}
  })
  return {arm, overallSuccessRate: rate, perTask}
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe('KPI harness', () => {
  describe('loadFixture', () => {
    it('parses the shipped reference fixture', () => {
      const fixture = loadFixture(REPO_FIXTURE_PATH)
      expect(fixture.fixtureVersion).to.equal('1.0.0')
      expect(fixture.targetModel).to.equal('llama-3.1-8b-instruct')
      expect(fixture.commandType).to.equal('curate')
      expect(fixture.tasks).to.have.length(20)
      for (const task of fixture.tasks) {
        expect(task.id).to.be.a('string').and.match(/^t\d{2}-/)
        expect(task.taskDescription).to.be.a('string').and.not.be.empty
        expect(task.expectedBehavior).to.be.a('string').and.not.be.empty
      }
    })

    it('throws on a malformed fixture', () => {
      const dir = mkdtempSync(join(tmpdir(), 'kpi-bad-'))
      try {
        const bad = join(dir, 'bad.json')
        writeFileSync(bad, JSON.stringify({tasks: [{id: 1}]}))
        expect(() => loadFixture(bad)).to.throw(/malformed/)
      } finally {
        rmSync(dir, {force: true, recursive: true})
      }
    })

    it('throws when tasks array is empty', () => {
      const dir = mkdtempSync(join(tmpdir(), 'kpi-empty-'))
      try {
        const empty = join(dir, 'empty.json')
        writeFileSync(empty, JSON.stringify({tasks: []}))
        expect(() => loadFixture(empty)).to.throw(/no tasks/)
      } finally {
        rmSync(dir, {force: true, recursive: true})
      }
    })
  })

  describe('makeStubLlmClient', () => {
    it('returns deterministic results per task + arm', async () => {
      const client = makeStubLlmClient()
      const task: FixtureTask = {
        expectedBehavior: 'x',
        id: 't01-list-exports',
        taskDescription: 'x',
      }
      // t01: raw=0, harness=1
      expect(await client.runTask(task, 'raw')).to.equal(false)
      expect(await client.runTask(task, 'harness')).to.equal(true)
      // Deterministic — repeated calls agree.
      expect(await client.runTask(task, 'raw')).to.equal(false)
      expect(await client.runTask(task, 'harness')).to.equal(true)
    })

    it('defaults to both-arms-succeed for unknown task ids', async () => {
      const client = makeStubLlmClient()
      const task: FixtureTask = {
        expectedBehavior: 'x',
        id: 'unknown-task',
        taskDescription: 'x',
      }
      expect(await client.runTask(task, 'raw')).to.equal(true)
      expect(await client.runTask(task, 'harness')).to.equal(true)
    })
  })

  describe('runArm', () => {
    it('aggregates success rate across N runs per task', async () => {
      const client: KpiLlmClient = {
        runTask: async () => true,
      }
      const tasks: FixtureTask[] = [
        {expectedBehavior: 'x', id: 'a', taskDescription: 'x'},
        {expectedBehavior: 'y', id: 'b', taskDescription: 'y'},
      ]
      const result = await runArm('raw', tasks, 5, client)
      expect(result.perTask).to.have.length(2)
      expect(result.perTask[0].runs).to.have.length(5)
      expect(result.overallSuccessRate).to.equal(1)
    })

    it('computes overall success rate as the flat mean across all runs', async () => {
      // Half of the 4 tasks always succeed; other half always fail.
      // With 2 runs each: 4 successes / 8 runs = 0.5.
      const client: KpiLlmClient = {
        runTask: async (task) => task.id.startsWith('good'),
      }
      const tasks: FixtureTask[] = [
        {expectedBehavior: 'x', id: 'good-1', taskDescription: 'x'},
        {expectedBehavior: 'x', id: 'good-2', taskDescription: 'x'},
        {expectedBehavior: 'x', id: 'bad-1', taskDescription: 'x'},
        {expectedBehavior: 'x', id: 'bad-2', taskDescription: 'x'},
      ]
      const result = await runArm('harness', tasks, 2, client)
      expect(result.overallSuccessRate).to.equal(0.5)
    })
  })

  describe('computeKpiReport', () => {
    it('computes delta as harness minus raw', () => {
      const fixture = makeFixture([
        {expectedBehavior: 'x', id: 'a', taskDescription: 'x'},
      ])
      const rawArm = makeArmResult('raw', ['a'], 0.4, 10)
      const harnessArm = makeArmResult('harness', ['a'], 0.8, 10)
      const report = computeKpiReport({fixture, harnessArm, rawArm, runsPerArm: 10})
      expect(report.rawSuccessRate).to.equal(0.4)
      expect(report.harnessSuccessRate).to.equal(0.8)
      expect(report.delta).to.be.closeTo(0.4, 1e-9)
    })

    it('carries fixture + model metadata through to the report', () => {
      const fixture = makeFixture([
        {expectedBehavior: 'x', id: 'a', taskDescription: 'x'},
      ])
      const rawArm = makeArmResult('raw', ['a'], 0, 1)
      const harnessArm = makeArmResult('harness', ['a'], 1, 1)
      const report = computeKpiReport({
        fixture,
        harnessArm,
        measuredAt: 1_700_000_000_000,
        rawArm,
        runsPerArm: 1,
      })
      expect(report.fixtureVersion).to.equal('test-1')
      expect(report.targetModel).to.equal('stub')
      expect(report.runsPerArm).to.equal(1)
      expect(report.measuredAt).to.equal(1_700_000_000_000)
    })
  })

  describe('exitCodeForReport', () => {
    it('exits 0 when delta ≥ ship-gate threshold (0.30)', () => {
      const report: KpiReport = {
        delta: SHIP_GATE_DELTA,
        fixtureVersion: 'x',
        harnessSuccessRate: 0.7,
        measuredAt: 0,
        perTask: [],
        rawSuccessRate: 0.4,
        runsPerArm: 10,
        targetModel: 'x',
      }
      expect(exitCodeForReport(report)).to.equal(0)
    })

    it('exits 1 when delta is just below (0.29)', () => {
      const report: KpiReport = {
        delta: 0.29,
        fixtureVersion: 'x',
        harnessSuccessRate: 0.69,
        measuredAt: 0,
        perTask: [],
        rawSuccessRate: 0.4,
        runsPerArm: 10,
        targetModel: 'x',
      }
      expect(exitCodeForReport(report)).to.equal(1)
    })

    it('exits 1 for zero / negative delta (harness worse)', () => {
      const report: KpiReport = {
        delta: -0.1,
        fixtureVersion: 'x',
        harnessSuccessRate: 0.3,
        measuredAt: 0,
        perTask: [],
        rawSuccessRate: 0.4,
        runsPerArm: 10,
        targetModel: 'x',
      }
      expect(exitCodeForReport(report)).to.equal(1)
    })
  })

  describe('parseArgs', () => {
    it('uses sane defaults', () => {
      const args = parseArgs([])
      expect(args.fixture).to.equal('scripts/autoharness-kpi/fixture-tasks.json')
      expect(args.llm).to.equal('stub')
      expect(args.runs).to.equal(10)
      expect(args.output).to.equal(undefined)
    })

    it('honors --fixture, --runs, --output, --llm', () => {
      const args = parseArgs([
        '--fixture',
        '/tmp/f.json',
        '--runs',
        '5',
        '--output',
        '/tmp/o.json',
        '--llm',
        'stub',
      ])
      expect(args.fixture).to.equal('/tmp/f.json')
      expect(args.runs).to.equal(5)
      expect(args.output).to.equal('/tmp/o.json')
      expect(args.llm).to.equal('stub')
    })

    it('rejects --llm other than stub|real', () => {
      expect(() => parseArgs(['--llm', 'fake'])).to.throw(/must be 'stub' or 'real'/)
    })

    it('rejects --runs non-numeric', () => {
      expect(() => parseArgs(['--runs', 'abc'])).to.throw(/positive integer/)
    })
  })

  describe('main (end-to-end with stub LLM)', () => {
    it('runs the shipped fixture and exits 0 at the ship gate', async function () {
      this.timeout(5000)
      const code = await main(['--fixture', REPO_FIXTURE_PATH, '--runs', '1'])
      // Stub rates: 10 tasks with delta 100%, 10 with delta 0% →
      // overall delta 0.50, well above the 0.30 gate.
      expect(code).to.equal(0)
    })

    it('writes the report JSON when --output is given', async function () {
      this.timeout(5000)
      const dir = mkdtempSync(join(tmpdir(), 'kpi-out-'))
      try {
        const out = join(dir, 'report.json')
        const code = await main([
          '--fixture',
          REPO_FIXTURE_PATH,
          '--runs',
          '1',
          '--output',
          out,
        ])
        expect(code).to.equal(0)
        const report = JSON.parse(readFileSync(out, 'utf8')) as KpiReport
        expect(report.rawSuccessRate).to.equal(0.5)
        expect(report.harnessSuccessRate).to.equal(1)
        expect(report.delta).to.equal(0.5)
        expect(report.perTask).to.have.length(20)
      } finally {
        rmSync(dir, {force: true, recursive: true})
      }
    })

    it('throws a clear error when --llm real is requested (follow-up work)', async () => {
      let caught: unknown
      try {
        await main(['--fixture', REPO_FIXTURE_PATH, '--llm', 'real'])
      } catch (error) {
        caught = error
      }

      expect(caught).to.be.an('error')
      expect((caught as Error).message).to.match(/--llm real is not yet implemented/)
    })
  })
})
