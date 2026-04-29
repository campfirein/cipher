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
import {executeCurate} from '../../../src/agent/infra/tools/implementations/curate-tool.js'

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

  // R-1 hotfix regression test (PHASE-2-UAT.md §5.4 Scenario 4):
  // UPDATE must preserve existing facts when the new operation carries
  // only the new fact. Pre-fix, executeUpdate's structural-loss machinery
  // ignored facts/keywords/tags — the existing fact was silently
  // overwritten by the single new fact and the original survived only
  // in `.brv/review-backups/`. Post-fix, both facts must coexist in the
  // live tree. See conflict-detector.ts + conflict-resolver.ts.
  it('preserves existing facts when UPDATE adds a new fact to the same subject', async () => {
    // Step A: ADD a fact about JWT token expiry.
    const addResult = await executeCurate({
      basePath,
      operations: [
        {
          confidence: 'high',
          content: {
            facts: [{statement: 'JWT tokens expire after 24 hours', subject: 'jwt_token_expiration'}],
          },
          impact: 'low',
          path: 'project/jwt_token_expiration',
          reason: 'initial add',
          summary: 'JWT tokens expire after 24 hours',
          title: 'jwt_tokens_expire_after_24_hours',
          type: 'ADD',
        },
      ],
    })

    expect(addResult.applied[0].status, JSON.stringify(addResult.applied)).to.equal('success')

    // Step B: UPDATE the same file with a new (different) fact.
    // Pre-fix, this overwrote the 24h fact entirely.
    const updateResult = await executeCurate({
      basePath,
      operations: [
        {
          confidence: 'high',
          content: {
            facts: [{statement: 'JWT tokens use SameSite=Strict', subject: 'jwt_samesite_policy'}],
          },
          impact: 'low',
          path: 'project/jwt_token_expiration',
          reason: 'subject "jwt_samesite_policy" already present',
          summary: 'JWT tokens use SameSite=Strict',
          title: 'jwt_tokens_expire_after_24_hours',
          type: 'UPDATE',
        },
      ],
    })

    expect(updateResult.applied[0].status, JSON.stringify(updateResult.applied)).to.equal('success')

    // Read the resulting file — BOTH facts must be present.
    const filePath = join(
      basePath,
      'project',
      'jwt_token_expiration',
      'jwt_tokens_expire_after_24_hours.md',
    )
    const content = await readFile(filePath, 'utf8')

    expect(content, 'original 24h fact must survive UPDATE').to.include('expire after 24 hours')
    expect(content, 'new SameSite fact must be present').to.include('SameSite=Strict')

    // R-6 (PHASE-2.5-PLAN.md §3.2): the frontmatter `summary:` field must
    // reflect the merged set, not just the most-recently-written fact.
    // Pre-fix, summary read 'JWT tokens use SameSite=Strict' only — Phase 3
    // UAT flagged this as a stale-header bug (file content vs frontmatter
    // disagreed). After R-6, summary is the `; `-joined statements.
    const summaryMatch = content.match(/^summary:\s*['"]?(.+?)['"]?\s*$/m)
    expect(summaryMatch, 'frontmatter must have a summary line').to.exist
    const summaryLine = summaryMatch![1]
    expect(summaryLine, 'merged summary must mention 24h fact').to.include('expire after 24 hours')
    expect(summaryLine, 'merged summary must mention SameSite fact').to.include('SameSite=Strict')
  })

  // R-4 hotfix (PHASE-2.5-PLAN.md §3.1): two new facts in one batch sharing
  // the same subject MUST consolidate into one file via the UPSERT path
  // (which routes the second through executeUpdate's safe merge), NOT
  // silently overwrite the first one (which would happen with type:'ADD'
  // because executeAdd has no fileExists check — same class of bug as R-1).
  it('two same-subject ADDs in one batch merge into ONE file via UPSERT (R-4 collision safety)', async () => {
    const services = buildLiveServices({
      agent: stubAgent(),
      basePath,
      lookupSubject: async () => [], // no existing memory; both decisions look like fresh ADDs
    })

    const result = await services.write!([
      {
        action: 'add',
        fact: {category: 'project', statement: 'JWT tokens expire after 24 hours', subject: 'auth'},
      },
      {
        action: 'add',
        // SAME subject as above — would collide if both went through ADD.
        fact: {category: 'project', statement: 'JWT tokens use httpOnly cookies', subject: 'auth'},
      },
    ])

    // Both ops report success (one ADDs the file, the second UPSERTs into it).
    expect(result.summary.failed, JSON.stringify(result.applied)).to.equal(0)
    expect(result.applied).to.have.length(2)
    for (const op of result.applied) {
      expect(op.status).to.equal('success')
    }

    // The file must live at <category>/<subject>/<subject>.md (R-4 title-from-subject).
    const filePath = join(basePath, 'project', 'auth', 'auth.md')
    const content = await readFile(filePath, 'utf8')

    // BOTH facts must be preserved in the merged file. If R-4 still used
    // type:'ADD', the second would have blind-overwritten the first.
    expect(content, 'first fact must survive collision').to.include('expire after 24 hours')
    expect(content, 'second fact must be present').to.include('httpOnly cookies')
  })

  it('R-4 derives ADD filename from fact.subject when present', async () => {
    const services = buildLiveServices({
      agent: stubAgent(),
      basePath,
      lookupSubject: async () => [],
    })

    await services.write!([
      {
        action: 'add',
        fact: {category: 'project', statement: 'Some long statement here for testing', subject: 'jwt_token_expiry'},
      },
    ])

    // Filename is <subject>.md, NOT a truncation of the statement.
    const expected = join(basePath, 'project', 'jwt_token_expiry', 'jwt_token_expiry.md')
    await readFile(expected, 'utf8') // throws if missing — that's the assertion
  })

  // R-2 (PHASE-2.5-PLAN.md §3.3): tags/keywords populated; relations
  // resolve to actual sibling files (slug-parity guard against the
  // toSnakeCase vs normalizeRelationPath mismatch).
  it('R-2 populates frontmatter tags, keywords, and relations on ADD', async () => {
    const services = buildLiveServices({
      agent: stubAgent(),
      basePath,
      lookupSubject: async () => [],
    })

    await services.write!([
      {
        action: 'add',
        fact: {category: 'project', statement: 'JWT tokens expire after 24 hours', subject: 'jwt_expiry'},
      },
      {
        action: 'add',
        fact: {category: 'project', statement: 'Rate limit is 100 req per minute per IP', subject: 'rate_limit'},
      },
    ])

    const filePath = join(basePath, 'project', 'jwt_expiry', 'jwt_expiry.md')
    const content = await readFile(filePath, 'utf8')

    // Writer uses YAML flow-style arrays (`tags: [a, b]`) per markdown-writer.ts:194.
    // Tags: category + subject
    expect(content, 'tags include category').to.match(/tags:\s*\[[^\]]*\bproject\b/)
    expect(content, 'tags include subject').to.match(/tags:\s*\[[^\]]*\bjwt_expiry\b/)

    // Keywords: subject + content tokens (filtered)
    expect(content, 'keywords include subject').to.match(/keywords:\s*\[[^\]]*\bjwt_expiry\b/)
    expect(content, 'keywords include content token').to.match(/keywords:\s*\[[^\]]*\btokens\b/)

    // Relations: 3-segment path linking the sibling
    expect(content, 'relations include sibling').to.match(/related:\s*\[[^\]]*project\/rate_limit\/rate_limit\.md/)
  })

  // R-2 SLUG PARITY (PHASE-2.5-PLAN review P1): subjects with HYPHENS
  // must produce relation paths the writer's actual file path matches.
  // toSnakeCase('rate-limit') → 'rate_limit'; normalizeRelationPath only
  // handles spaces, so without the deriveRelated slug fix the relation
  // would be 'project/rate-limit/rate-limit.md' but the file would be
  // at 'project/rate_limit/rate_limit.md'. Broken link.
  it('R-2 derived `related` paths point to actual sibling files (slug parity for hyphens)', async () => {
    const services = buildLiveServices({
      agent: stubAgent(),
      basePath,
      lookupSubject: async () => [],
    })

    await services.write!([
      {action: 'add', fact: {category: 'project', statement: 'Rate limit is 100/min', subject: 'rate-limit'}},
      {action: 'add', fact: {category: 'project', statement: 'JWT expires in 24h', subject: 'jwt-token'}},
    ])

    // First file's `related` should resolve to the second file's actual on-disk path.
    const firstFilePath = join(basePath, 'project', 'rate_limit', 'rate_limit.md')
    const content = await readFile(firstFilePath, 'utf8')

    // Relation must use the slugged form (jwt_token, not jwt-token).
    expect(content, 'relation must use snake_case sibling').to.match(/project\/jwt_token\/jwt_token\.md/)
    expect(content, 'relation must NOT preserve hyphen').to.not.include('jwt-token')

    // The file the relation points at must exist on disk.
    await readFile(join(basePath, 'project', 'jwt_token', 'jwt_token.md'), 'utf8') // throws if missing
  })

  // R-3 (PHASE-2.5-PLAN.md §3.4): per-leaf `Reason` carries cur-<logId> +
  // source provenance + statement preview. Envelope is emitted on EVERY
  // path, including UPDATE (review P2 — UPDATE used to bypass provenance).
  it('R-3 Reason envelope appears on ADD with cur-logId + source + statement preview', async () => {
    const services = buildLiveServices({
      agent: stubAgent(),
      basePath,
      logId: 'cur-1777347876578',
      lookupSubject: async () => [],
      provenance: {name: 'cli-text', type: 'text'},
      taskId: 'task-uuid-A',
    })

    await services.write!([
      {
        action: 'add',
        fact: {category: 'project', statement: 'JWT tokens expire after 24 hours', subject: 'jwt_expiry'},
      },
    ])

    const filePath = join(basePath, 'project', 'jwt_expiry', 'jwt_expiry.md')
    const content = await readFile(filePath, 'utf8')
    expect(content, 'Reason includes cur-<id>').to.include('Curated from cur-1777347876578')
    expect(content, 'Reason includes provenance').to.include('text:"cli-text"')
    expect(content, 'Reason includes subject').to.include('"jwt_expiry"')
    expect(content, 'Reason includes category bracket').to.include('[project]')
    expect(content, 'Reason includes statement preview').to.include('JWT tokens expire after 24 hours')
    expect(content, 'ADD has no Decision: appendix').to.not.include('Decision:')
  })

  it('R-3 Reason envelope appears on UPDATE AND appends d.reason as Decision: (P2 fix)', async () => {
    // Pre-seed an existing file so the second op routes through executeUpdate.
    const seedServices = buildLiveServices({
      agent: stubAgent(),
      basePath,
      lookupSubject: async () => [],
      provenance: {name: 'seed', type: 'text'},
      taskId: 'seed-task',
    })
    await seedServices.write!([
      {action: 'add', fact: {category: 'project', statement: 'seed fact', subject: 'shared_subject'}},
    ])

    // Now an UPDATE decision with a placeholder reason from detectConflicts.
    const services = buildLiveServices({
      agent: stubAgent(),
      basePath,
      logId: 'cur-1777347889041',
      lookupSubject: async () => [],
      provenance: {name: 'cli-text', type: 'text'},
      taskId: 'task-uuid-B',
    })
    await services.write!([
      {
        action: 'update',
        existingId: 'project/shared_subject/shared_subject.md',
        fact: {category: 'project', statement: 'new related fact', subject: 'shared_subject'},
        reason: 'subject "shared_subject" already present at project/shared_subject/shared_subject.md',
      },
    ])

    const filePath = join(basePath, 'project', 'shared_subject', 'shared_subject.md')
    const content = await readFile(filePath, 'utf8')
    // Envelope must be present (review P2 — pre-fix this was missing entirely on UPDATE).
    expect(content, 'UPDATE Reason includes cur-<id>').to.include('Curated from cur-1777347889041')
    expect(content, 'UPDATE Reason includes provenance').to.include('text:"cli-text"')
    expect(content, 'UPDATE Reason includes subject').to.include('"shared_subject"')
    // d.reason appended as Decision: AFTER envelope.
    expect(content, 'UPDATE Reason appends Decision: with d.reason').to.include('Decision: subject "shared_subject" already present')
  })

  // NEW-1 (PHASE-2.6-PLAN.md §3.2): when multiple decisions in one batch
  // resolve to the SAME target file (UPSERT collision OR cross-batch
  // UPDATE merge), the merged file's `related` field must NOT reference
  // any of those merged-away subjects as if they were separate files.
  // Phase 4 UAT showed `related: [project/jwt_storage/jwt_storage.md, ...]`
  // pointing to files that were never created.
  it('NEW-1: in-batch UPSERT collision produces ZERO dangling related paths', async () => {
    const services = buildLiveServices({
      agent: stubAgent(),
      basePath,
      lookupSubject: async () => [],
    })

    // Three same-subject decisions. R-4 UPSERT consolidates all three into
    // ONE file (project/auth/auth.md). related must NOT list phantom siblings.
    await services.write!([
      {action: 'add', fact: {category: 'project', statement: 'Auth uses JWT', subject: 'auth'}},
      {action: 'add', fact: {category: 'project', statement: 'Auth httpOnly cookies', subject: 'auth'}},
      {action: 'add', fact: {category: 'project', statement: 'Auth SameSite=Strict', subject: 'auth'}},
    ])

    const file = join(basePath, 'project', 'auth', 'auth.md')
    const content = await readFile(file, 'utf8')

    const m = content.match(/^related:\s*\[(.*?)\]/m)
    expect(m, 'frontmatter must have a related line').to.exist
    if (m![1].trim().length > 0) {
      const paths = m![1].split(',').map((s) => s.trim().replaceAll(/['"]/g, '')).filter(Boolean)
      // Must resolve to files that exist. Promise.all so any missing file
      // surfaces as ENOENT immediately — that's the assertion.
      await Promise.all(paths.map((relPath) => readFile(join(basePath, relPath), 'utf8')))
    }
  })

  it('NEW-1: cross-batch UPDATE merge (Scenario 4 reproducer) produces ZERO dangling related paths', async () => {
    // Pre-seed an existing file at project/jwt_expiry/jwt_expiry.md
    const seed = buildLiveServices({
      agent: stubAgent(),
      basePath,
      lookupSubject: async () => [],
    })
    await seed.write!([
      {action: 'add', fact: {category: 'project', statement: 'JWT 24h', subject: 'jwt_expiry'}},
    ])

    // Now simulate Scenario 4 step B: 2 decisions with DIFFERENT subjects all
    // matched to the existing file by lookupSubject → both UPDATE-route to
    // jwt_expiry.md. Their `related` would normally cross-link each other
    // as separate sibling files; post-fix they must not.
    const matchedExistingId = 'project/jwt_expiry/jwt_expiry.md'
    const services = buildLiveServices({
      agent: stubAgent(),
      basePath,
      lookupSubject: async () => [{existingId: matchedExistingId, statement: matchedExistingId}],
    })

    await services.write!([
      {action: 'update', existingId: matchedExistingId, fact: {category: 'project', statement: 'TTL', subject: 'jwt_ttl'}},
      {action: 'update', existingId: matchedExistingId, fact: {category: 'project', statement: 'cookies', subject: 'jwt_storage'}},
    ])

    const file = join(basePath, 'project', 'jwt_expiry', 'jwt_expiry.md')
    const content = await readFile(file, 'utf8')

    const m = content.match(/^related:\s*\[(.*?)\]/m)
    expect(m, 'frontmatter must have a related line').to.exist
    if (m![1].trim().length > 0) {
      const paths = m![1].split(',').map((s) => s.trim().replaceAll(/['"]/g, '')).filter(Boolean)
      // Phantom paths like 'project/jwt_storage/jwt_storage.md' would throw
      // here pre-fix. Promise.all surfaces any missing file as ENOENT.
      await Promise.all(paths.map((relPath) => readFile(join(basePath, relPath), 'utf8')))
    }
  })
})
