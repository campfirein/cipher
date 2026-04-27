/**
 * Phase 1 — services-adapter live write path integration test.
 *
 * Exercises `buildLiveServices(...).write(...)` against the REAL `executeCurate`
 * implementation (not a stub) writing to a tempdir. This is the production
 * path that the cutover put in place; the DAG snapshot tests stub services
 * and would not catch executeCurate-side regressions like the
 * "Invalid path format" bug uncovered in code review.
 *
 * If you change the operation shape produced by `services-adapter.write`,
 * this test is what protects you from silently producing failed writes.
 */

import {expect} from 'chai'
import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ICipherAgent} from '../../../src/agent/core/interfaces/i-cipher-agent.js'

import {buildLiveServices} from '../../../src/agent/infra/curation/flow/services-adapter.js'

function stubAgent(): ICipherAgent {
  // write() does not call agent.generate; an empty stub is fine here.
  return {} as ICipherAgent
}

describe('services-adapter — live write to tempdir via real executeCurate', () => {
  let tempDir: string
  let basePath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'brv-curate-flow-'))
    basePath = join(tempDir, '.brv', 'context-tree')
  })

  afterEach(async () => {
    // eslint-disable-next-line unicorn/no-useless-undefined -- explicit `undefined` keeps awaited type narrow
    await rm(tempDir, {force: true, recursive: true}).catch(() => undefined)
  })

  it('produces a 2+ segment path so executeCurate accepts ADD operations', async () => {
    const services = buildLiveServices({
      agent: stubAgent(),
      basePath,
      lookupSubject: async () => [],
    })

    const result = await services.write!([
      {
        action: 'add',
        fact: {category: 'project', statement: 'JWT tokens expire after 24 hours', subject: 'auth'},
      },
    ])

    // The big regression catcher: every applied op must report success,
    // not "Invalid path format".
    expect(result.summary.failed, JSON.stringify(result.applied)).to.equal(0)
    expect(result.summary.added).to.equal(1)
    expect(result.applied).to.have.length(1)
    expect(result.applied[0].status).to.equal('success')
    expect(result.applied[0].path).to.match(/\//) // multi-segment
  })

  it('falls back to "extracted" domain when fact.category is missing', async () => {
    const services = buildLiveServices({
      agent: stubAgent(),
      basePath,
      lookupSubject: async () => [],
    })

    const result = await services.write!([
      {
        action: 'add',
        // no category → domain defaults to 'extracted', topic = subject
        fact: {statement: 'Database is PostgreSQL 15', subject: 'database'},
      },
    ])

    expect(result.summary.failed, JSON.stringify(result.applied)).to.equal(0)
    expect(result.summary.added).to.equal(1)

    // Verify the file actually landed under the expected folder.
    const extractedDir = await readdir(join(basePath, 'extracted'))
    expect(extractedDir).to.include('database')
  })

  it('writes a non-empty markdown file the curate-tool can later read', async () => {
    const services = buildLiveServices({
      agent: stubAgent(),
      basePath,
      lookupSubject: async () => [],
    })

    await services.write!([
      {
        action: 'add',
        fact: {category: 'project', statement: 'Auth uses JWT in httpOnly cookies', subject: 'auth'},
      },
    ])

    const projectDir = await readdir(join(basePath, 'project', 'auth'))
    const mdFile = projectDir.find((f) => f.endsWith('.md'))
    expect(mdFile, 'expected at least one .md file under project/auth').to.exist

    if (mdFile) {
      const content = await readFile(join(basePath, 'project', 'auth', mdFile), 'utf8')
      expect(content.length).to.be.greaterThan(0)
      expect(content).to.include('Auth uses JWT in httpOnly cookies')
    }
  })

  it('UPDATE honors existingId — points at matched existing file, not a new title', async () => {
    // Regression for the "UPDATE writes ignore the matched existing file" bug:
    // detectConflicts sets `existingId` to the path of the matched file;
    // write() must use that path verbatim rather than re-deriving the title
    // from the new statement (which would point at a different file).
    const services = buildLiveServices({
      agent: stubAgent(),
      basePath,
      lookupSubject: async () => [],
    })

    // Step 1: ADD an initial fact, then discover the actual file path the
    // curate-tool wrote (snake-cased title + .md suffix under the topic
    // folder). That relative path is what the existing-memory loader would
    // later return as `existingId` for the same subject in production.
    const addResult = await services.write!([
      {
        action: 'add',
        fact: {category: 'project', statement: 'Auth uses JWT', subject: 'auth'},
      },
    ])
    expect(addResult.summary.failed, JSON.stringify(addResult.applied)).to.equal(0)

    const topicDir = await readdir(join(basePath, 'project', 'auth'))
    const addedFile = topicDir.find((f) => f.endsWith('.md') && f !== 'context.md')
    expect(addedFile, 'expected the ADD to leave a non-context .md file').to.exist
    const existingId = `project/auth/${addedFile!}` // mirrors loader output shape

    // Step 2: UPDATE the same fact (different statement) by passing the
    // captured path as `existingId`. Pre-fix this returned
    // "File does not exist: project/auth/auth_uses_jwt_in_httponly_cookies.md".
    const updateResult = await services.write!([
      {
        action: 'update',
        existingId,
        fact: {
          category: 'project',
          statement: 'Auth uses JWT in httpOnly cookies (24h expiry)',
          subject: 'auth',
        },
        reason: 'Refining JWT description with cookie + expiry detail',
      },
    ])

    expect(updateResult.summary.failed, JSON.stringify(updateResult.applied)).to.equal(0)
    expect(updateResult.summary.updated).to.equal(1)
    expect(updateResult.applied).to.have.length(1)
    expect(updateResult.applied[0].status).to.equal('success')

    // Verify the same on-disk file was modified (no new file created).
    const topicDirAfter = await readdir(join(basePath, 'project', 'auth'))
    const mdFilesAfter = topicDirAfter.filter((f) => f.endsWith('.md') && f !== 'context.md')
    expect(mdFilesAfter, 'no new .md file should be created on UPDATE').to.have.length(1)
    expect(mdFilesAfter[0]).to.equal(addedFile)
  })

  it('UPDATE falls back to ADD when existingId is missing or unparseable', async () => {
    // Defensive behavior: an UPDATE without a valid existingId would fail
    // with "File does not exist" if we issued an UPDATE op blindly. The
    // adapter falls back to ADD in this case so the new content still lands.
    const services = buildLiveServices({
      agent: stubAgent(),
      basePath,
      lookupSubject: async () => [],
    })

    const result = await services.write!([
      {
        action: 'update', // marked update but no existingId
        fact: {category: 'project', statement: 'Some new fact', subject: 'newsubject'},
      },
      {
        action: 'update',
        existingId: 'malformed', // unparseable (single segment)
        fact: {category: 'project', statement: 'Another new fact', subject: 'othersubject'},
      },
    ])

    expect(result.summary.failed, JSON.stringify(result.applied)).to.equal(0)
    expect(result.summary.added).to.equal(2)
    expect(result.summary.updated).to.equal(0)
  })

  it('handles multiple decisions in a single write call', async () => {
    const services = buildLiveServices({
      agent: stubAgent(),
      basePath,
      lookupSubject: async () => [],
    })

    const result = await services.write!([
      {
        action: 'add',
        fact: {category: 'project', statement: 'JWT expires in 24h', subject: 'auth'},
      },
      {
        action: 'add',
        fact: {category: 'environment', statement: 'PostgreSQL 15', subject: 'database'},
      },
      {
        action: 'add',
        fact: {statement: 'Rate limit is 100/min per IP', subject: 'rate-limit'},
      },
    ])

    expect(result.summary.failed, JSON.stringify(result.applied)).to.equal(0)
    expect(result.summary.added).to.equal(3)
    expect(result.applied).to.have.length(3)
    for (const op of result.applied) {
      expect(op.status).to.equal('success')
    }
  })
})
