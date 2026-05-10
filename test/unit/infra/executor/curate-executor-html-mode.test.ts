/**
 * CurateExecutor HTML-mode tests.
 *
 * The executor branches on `options.useHtmlContextTree`:
 *   - true:  agent's final response is the bv-topic HTML; route through
 *            html-writer; status reflects the write outcome.
 *   - false: existing markdown path runs unchanged (parseCurationStatus).
 *
 * These tests stub the agent's response and assert the file is written
 * (or not), the lastStatus is shaped correctly, and the markdown path
 * is untouched when the flag is off.
 */

import {expect} from 'chai'
import {existsSync, readFileSync} from 'node:fs'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, stub} from 'sinon'

import type {ICipherAgent} from '../../../../src/agent/core/interfaces/i-cipher-agent.js'

import {CurateExecutor} from '../../../../src/server/infra/executor/curate-executor.js'

const VALID_HTML_TOPIC = `<bv-topic path="security/auth" title="JWT auth">
  <bv-reason>Document JWT auth design.</bv-reason>
  <bv-rule severity="must" id="r-1">Always validate signatures.</bv-rule>
</bv-topic>`

function buildAgent(executeOnSessionResult: string): ICipherAgent {
  return {
    cancel: stub().resolves(false),
    createTaskSession: stub().resolves('session-id'),
    deleteSandboxVariable: stub(),
    deleteSandboxVariableOnSession: stub(),
    deleteSession: stub().resolves(true),
    deleteTaskSession: stub().resolves(),
    execute: stub().resolves(''),
    executeOnSession: stub().resolves(executeOnSessionResult),
    generate: stub().resolves({content: '', toolCalls: [], usage: {inputTokens: 0, outputTokens: 0}}),
    getSessionMetadata: stub().resolves(),
    getState: stub().returns({currentIteration: 0, executionHistory: [], executionState: 'idle', toolCallsExecuted: 0}),
    listPersistedSessions: stub().resolves([]),
    reset: stub(),
    setSandboxVariable: stub(),
    setSandboxVariableOnSession: stub(),
    start: stub().resolves(),
    stream: stub().resolves({[Symbol.asyncIterator]: () => ({next: () => Promise.resolve({done: true, value: undefined})})}),
  } as unknown as ICipherAgent
}

describe('CurateExecutor HTML mode', () => {
  let baseDir: string

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'curate-executor-html-'))
    // The executor expects `<baseDir>/.brv/context-tree/` to be the
    // write root. Pre-create the directory tree so html-writer's
    // atomic write doesn't have to materialise it through the I/O
    // helper (the helper handles missing intermediate dirs already,
    // but pre-creating keeps the test boundary tight).
    await mkdir(join(baseDir, '.brv', 'context-tree'), {recursive: true})
  })

  afterEach(async () => {
    restore()
    await rm(baseDir, {force: true, recursive: true})
  })

  it('writes a valid HTML topic to <baseDir>/.brv/context-tree/<path>.html', async () => {
    const agent = buildAgent(VALID_HTML_TOPIC)
    const executor = new CurateExecutor()

    const {response} = await executor.runAgentBody(agent, {
      content: 'curate this',
      projectRoot: baseDir,
      taskId: 'task-html-1',
      useHtmlContextTree: true,
    })

    const expectedPath = join(baseDir, '.brv', 'context-tree', 'security/auth.html')
    expect(existsSync(expectedPath), `expected file at ${expectedPath}`).to.equal(true)
    expect(readFileSync(expectedPath, 'utf8')).to.equal(VALID_HTML_TOPIC)
    // Response is the raw agent output (returned unchanged).
    expect(response).to.equal(VALID_HTML_TOPIC)
    expect(executor.lastStatus?.status).to.equal('success')
    expect(executor.lastStatus?.summary.added).to.equal(1)
    expect(executor.lastStatus?.summary.failed).to.equal(0)
  })

  it('strips a wrapping ```html fence from the agent response before writing', async () => {
    const wrapped = '```html\n' + VALID_HTML_TOPIC + '\n```'
    const agent = buildAgent(wrapped)
    const executor = new CurateExecutor()

    await executor.runAgentBody(agent, {
      content: 'curate this',
      projectRoot: baseDir,
      taskId: 'task-html-2',
      useHtmlContextTree: true,
    })

    const expectedPath = join(baseDir, '.brv', 'context-tree', 'security/auth.html')
    expect(existsSync(expectedPath)).to.equal(true)
    expect(readFileSync(expectedPath, 'utf8')).to.equal(VALID_HTML_TOPIC)
    expect(executor.lastStatus?.status).to.equal('success')
  })

  it('records failed status (no file written) when response has no <bv-topic>', async () => {
    const agent = buildAgent('<p>not a topic</p>')
    const executor = new CurateExecutor()

    await executor.runAgentBody(agent, {
      content: 'curate this',
      projectRoot: baseDir,
      taskId: 'task-html-3',
      useHtmlContextTree: true,
    })

    expect(executor.lastStatus?.status).to.equal('failed')
    expect(executor.lastStatus?.summary.failed).to.equal(1)
    expect(executor.lastStatus?.verification.missing.length).to.be.greaterThan(0)
    // No file was written.
    expect(executor.lastStatus?.summary.added).to.equal(0)
  })

  it('records failed status when response has invalid attribute values', async () => {
    const invalid = `<bv-topic path="x" title="t">
      <bv-rule severity="urgent">x</bv-rule>
    </bv-topic>`
    const agent = buildAgent(invalid)
    const executor = new CurateExecutor()

    await executor.runAgentBody(agent, {
      content: 'curate this',
      projectRoot: baseDir,
      taskId: 'task-html-4',
      useHtmlContextTree: true,
    })

    expect(executor.lastStatus?.status).to.equal('failed')
    expect(executor.lastStatus?.verification.missing.some((m) => m.includes('attribute-validation'))).to.equal(true)
  })

  it('uses the existing markdown parseCurationStatus path when the flag is false', async () => {
    // The agent's response includes the JSON status block the markdown
    // path expects. handleHtmlCurateResponse should NOT be called in
    // this branch; lastStatus is sourced from parseCurationStatus.
    const mdResponse = `Curated successfully.\n\n\`\`\`json\n${JSON.stringify({
      summary: {added: 2, deleted: 0, failed: 0, merged: 0, updated: 1},
      verification: {checked: 3, confirmed: 3, missing: []},
    })}\n\`\`\``
    const agent = buildAgent(mdResponse)
    const executor = new CurateExecutor()

    await executor.runAgentBody(agent, {
      content: 'curate this',
      projectRoot: baseDir,
      taskId: 'task-md-1',
      useHtmlContextTree: false,
    })

    expect(executor.lastStatus?.status).to.equal('success')
    expect(executor.lastStatus?.summary.added).to.equal(2)
    expect(executor.lastStatus?.summary.updated).to.equal(1)
    // No html file should be written when flag is off.
    const htmlPath = join(baseDir, '.brv', 'context-tree', 'security/auth.html')
    expect(existsSync(htmlPath)).to.equal(false)
  })

  it('uses the markdown path when the flag is undefined (default)', async () => {
    const agent = buildAgent('Curated.')
    const executor = new CurateExecutor()

    await executor.runAgentBody(agent, {
      content: 'curate this',
      projectRoot: baseDir,
      taskId: 'task-md-2',
      // useHtmlContextTree intentionally omitted.
    })

    // Falls through to fallback heuristic in parseCurationStatus.
    expect(executor.lastStatus?.status).to.equal('success')
    const htmlPath = join(baseDir, '.brv', 'context-tree', 'security/auth.html')
    expect(existsSync(htmlPath)).to.equal(false)
  })
})
