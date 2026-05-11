/**
 * curate-session orchestrator tests.
 *
 * TKT 02 wires the real state machine on top of TKT 01's protocol
 * surface: continuations run `validateHtmlTopic` + `writeHtmlTopic`
 * against the response; valid input writes the topic file and ends the
 * session with `done`; invalid input emits a `correct-html` step
 * carrying structured errors and keeps the session alive; after
 * MAX_ATTEMPTS (= 4: one generate + three corrections) the session
 * terminates `failed`.
 *
 * Tests cover the full state machine, retry cap, error mapping from
 * the writer to the wire envelope, path-traversal sessionId rejection,
 * corrupted state handling, and the documented envelope-shape contract.
 */

const VALID_TOPIC_HTML = '<bv-topic path="security/auth" title="JWT auth"><bv-reason>x</bv-reason></bv-topic>'
const TOPIC_WITHOUT_PATH = '<bv-topic title="JWT auth"></bv-topic>'

import {expect} from 'chai'
import {existsSync} from 'node:fs'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  continueSession,
  CURATE_SESSION_PREFIX,
  CURATE_SESSIONS_DIR,
  kickoffSession,
  resolveProjectRoot,
} from '../../../../src/oclif/lib/curate-session.js'
import {BRV_DIR} from '../../../../src/server/constants.js'

const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

describe('curate-session placeholder', () => {
  let projectRoot: string

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'curate-session-'))
  })

  afterEach(async () => {
    await rm(projectRoot, {force: true, recursive: true})
  })

  describe('kickoffSession', () => {
    it('returns needs-llm-step with a fresh uuid sessionId', async () => {
      const envelope = await kickoffSession({content: 'remember we use RS256', projectRoot})

      expect(envelope.ok).to.equal(true)
      expect(envelope.status).to.equal('needs-llm-step')
      expect(envelope.step).to.equal('generate-html')
      expect(envelope.sessionId).to.be.a('string')
      expect(envelope.sessionId!).to.match(UUID_RE)
    })

    it('includes a stub prompt that embeds the user intent verbatim', async () => {
      const intent = 'remember the JWT signing rotation policy'
      const envelope = await kickoffSession({content: intent, projectRoot})

      expect(envelope.prompt).to.be.a('string')
      expect(envelope.prompt!).to.include(intent)
    })

    it('does not include filePath or errors on a kickoff envelope', async () => {
      const envelope = await kickoffSession({content: 'x', projectRoot})

      expect(envelope.filePath).to.equal(undefined)
      expect(envelope.errors).to.equal(undefined)
    })

    it('writes on-disk state at the documented path with the initial schema', async () => {
      const envelope = await kickoffSession({content: 'x', projectRoot})
      const statePath = join(
        projectRoot,
        BRV_DIR,
        CURATE_SESSIONS_DIR,
        `${CURATE_SESSION_PREFIX}${envelope.sessionId!}`,
        'state.json',
      )

      expect(existsSync(statePath)).to.equal(true)

      const state = JSON.parse(await readFile(statePath, 'utf8'))
      expect(state.userIntent).to.equal('x')
      expect(state.step).to.equal('awaiting-generate')
      expect(state.attempts).to.equal(0)
      expect(state.lastResponse).to.equal('')
      expect(state.createdAt).to.be.a('number')
    })

    it('two kickoffs against the same project return distinct sessionIds', async () => {
      const a = await kickoffSession({content: 'a', projectRoot})
      const b = await kickoffSession({content: 'b', projectRoot})

      expect(a.sessionId).to.not.equal(b.sessionId)
    })
  })

  describe('continueSession — happy path (valid HTML)', () => {
    it('writes the topic file and returns done with the relative path on first valid response', async () => {
      const kickoff = await kickoffSession({content: 'remember JWT', projectRoot})
      const sessionId = kickoff.sessionId!

      const envelope = await continueSession({projectRoot, response: VALID_TOPIC_HTML, sessionId})

      expect(envelope.ok).to.equal(true)
      expect(envelope.status).to.equal('done')
      // filePath is relative to .brv/context-tree/, derived from the bv-topic's path attribute
      expect(envelope.filePath).to.equal('security/auth.html')

      // File actually landed on disk
      const onDisk = join(projectRoot, BRV_DIR, 'context-tree', 'security', 'auth.html')
      expect(existsSync(onDisk)).to.equal(true)

      // Session cleared on success
      const stateDir = join(projectRoot, BRV_DIR, CURATE_SESSIONS_DIR, `${CURATE_SESSION_PREFIX}${sessionId}`)
      expect(existsSync(stateDir)).to.equal(false)
    })

    it('second continuation against a completed sessionId returns unknown-session', async () => {
      const kickoff = await kickoffSession({content: 'x', projectRoot})
      const sessionId = kickoff.sessionId!

      // First continuation succeeds and clears state
      await continueSession({projectRoot, response: VALID_TOPIC_HTML, sessionId})

      // Second continuation must fail — done sessions are not resumable
      const envelope = await continueSession({projectRoot, response: VALID_TOPIC_HTML, sessionId})

      expect(envelope.status).to.equal('failed')
      expect(envelope.errors![0].kind).to.equal('unknown-session')
    })
  })

  describe('continueSession — correction loop (invalid HTML)', () => {
    it('emits correct-html with structured errors on first invalid response; session stays alive', async () => {
      const kickoff = await kickoffSession({content: 'x', projectRoot})
      const sessionId = kickoff.sessionId!

      const envelope = await continueSession({projectRoot, response: TOPIC_WITHOUT_PATH, sessionId})

      expect(envelope.ok).to.equal(false)
      expect(envelope.status).to.equal('needs-llm-step')
      expect(envelope.step).to.equal('correct-html')
      expect(envelope.sessionId).to.equal(sessionId)
      expect(envelope.prompt).to.be.a('string')

      // Errors carry the writer's missing-path-attribute kind
      expect(envelope.errors!.some((e) => e.kind === 'missing-path-attribute')).to.equal(true)

      // Session stays on disk for the retry
      const stateDir = join(projectRoot, BRV_DIR, CURATE_SESSIONS_DIR, `${CURATE_SESSION_PREFIX}${sessionId}`)
      expect(existsSync(stateDir)).to.equal(true)

      // State machine advanced to awaiting-correct + attempts=1
      const state = JSON.parse(await readFile(join(stateDir, 'state.json'), 'utf8'))
      expect(state.step).to.equal('awaiting-correct')
      expect(state.attempts).to.equal(1)
      expect(state.lastResponse).to.equal(TOPIC_WITHOUT_PATH)
    })

    it('accepts a corrected response after an invalid one and writes the file', async () => {
      const kickoff = await kickoffSession({content: 'x', projectRoot})
      const sessionId = kickoff.sessionId!

      // First: invalid → correct-html
      await continueSession({projectRoot, response: TOPIC_WITHOUT_PATH, sessionId})

      // Second: valid → done
      const envelope = await continueSession({projectRoot, response: VALID_TOPIC_HTML, sessionId})

      expect(envelope.status).to.equal('done')
      expect(envelope.filePath).to.equal('security/auth.html')
      const stateDir = join(projectRoot, BRV_DIR, CURATE_SESSIONS_DIR, `${CURATE_SESSION_PREFIX}${sessionId}`)
      expect(existsSync(stateDir)).to.equal(false)
    })

    it('terminates the session with retry-cap-exceeded after MAX_ATTEMPTS invalid responses', async () => {
      const kickoff = await kickoffSession({content: 'x', projectRoot})
      const sessionId = kickoff.sessionId!

      // Submit MAX_ATTEMPTS=4 invalid responses in a row. The first
      // three each move state machine to awaiting-correct; the fourth
      // exhausts the retry cap and terminates `failed`.
      const envelopes: Array<Awaited<ReturnType<typeof continueSession>>> = []
      for (let i = 0; i < 4; i++) {
        // eslint-disable-next-line no-await-in-loop
        const envelope = await continueSession({projectRoot, response: TOPIC_WITHOUT_PATH, sessionId})
        envelopes.push(envelope)
      }

      // First 3 invalid responses → correct-html, session alive
      for (let i = 0; i < 3; i++) {
        expect(envelopes[i].status, `attempt ${i + 1}`).to.equal('needs-llm-step')
        expect(envelopes[i].step, `attempt ${i + 1}`).to.equal('correct-html')
      }

      // 4th invalid response → terminal failed with retry-cap-exceeded
      const final = envelopes[3]
      expect(final.status).to.equal('failed')
      expect(final.errors!.some((e) => e.kind === 'retry-cap-exceeded')).to.equal(true)
      expect(final.sessionId).to.equal(undefined)

      // Session cleared on terminal failure
      const stateDir = join(projectRoot, BRV_DIR, CURATE_SESSIONS_DIR, `${CURATE_SESSION_PREFIX}${sessionId}`)
      expect(existsSync(stateDir)).to.equal(false)
    })

    it('correction-prompt embeds the previous response so the calling agent can target the fix', async () => {
      const kickoff = await kickoffSession({content: 'x', projectRoot})
      const envelope = await continueSession({projectRoot, response: TOPIC_WITHOUT_PATH, sessionId: kickoff.sessionId!})

      expect(envelope.prompt).to.include(TOPIC_WITHOUT_PATH)
    })

    it('maps writer error kinds into the envelope error shape', async () => {
      const kickoff = await kickoffSession({content: 'x', projectRoot})
      const sessionId = kickoff.sessionId!

      // Trigger unknown-bv-element error: a tag that isn't in the registry
      const html = '<bv-topic path="x/y" title="t"><bv-not-a-real-tag/></bv-topic>'
      const envelope = await continueSession({projectRoot, response: html, sessionId})

      const unknown = envelope.errors!.find((e) => e.kind === 'unknown-element')
      expect(unknown, 'expected unknown-element error in envelope').to.not.equal(undefined)
      expect(unknown!.tag).to.equal('bv-not-a-real-tag')
    })
  })

  describe('continueSession — non-HTML failures', () => {
    it('returns failed with unknown-session for an unknown sessionId', async () => {
      const envelope = await continueSession({
        projectRoot,
        response: VALID_TOPIC_HTML,
        sessionId: '00000000-0000-0000-0000-000000000000',
      })

      expect(envelope.ok).to.equal(false)
      expect(envelope.status).to.equal('failed')
      expect(envelope.errors).to.be.an('array').with.lengthOf(1)
      expect(envelope.errors![0].kind).to.equal('unknown-session')
    })

    it('returns failed with empty-response for an empty payload, keeps the session live', async () => {
      const kickoff = await kickoffSession({content: 'x', projectRoot})
      const sessionId = kickoff.sessionId!

      const envelope = await continueSession({projectRoot, response: '   ', sessionId})

      expect(envelope.status).to.equal('failed')
      expect(envelope.errors![0].kind).to.equal('empty-response')
      expect(envelope.sessionId).to.equal(sessionId)

      const stateDir = join(projectRoot, BRV_DIR, CURATE_SESSIONS_DIR, `${CURATE_SESSION_PREFIX}${sessionId}`)
      expect(existsSync(stateDir)).to.equal(true)
    })
  })

  describe('continueSession — security + robustness', () => {
    it('rejects path-traversal sessionId before any filesystem access', async () => {
      // `--session "../../../etc"` would, without validation, get
      // path-joined into `.brv/sessions/curate-../../../etc/state.json`
      // and resolve outside the project. The fix: validate against the
      // uuid shape up front. Either way the caller sees the same
      // `unknown-session` outcome — we don't leak that we're
      // path-traversal-checking.
      const traversalAttempts = [
        '../../../etc',
        '../sibling-project',
        '/absolute/path',
        '..',
        'curate-/../escape',
        '8609bc28-9a44-41a1-b52d-423213d5f59d/extra', // looks uuid-ish but trailing segment
      ]

      for (const sessionId of traversalAttempts) {
        // eslint-disable-next-line no-await-in-loop
        const envelope = await continueSession({projectRoot, response: 'x', sessionId})
        expect(envelope.status, `case: ${sessionId}`).to.equal('failed')
        expect(envelope.errors![0].kind, `case: ${sessionId}`).to.equal('unknown-session')
      }
    })

    it('treats a corrupted state.json as no session (type-guarded readback)', async () => {
      const kickoff = await kickoffSession({content: 'x', projectRoot})
      const sessionId = kickoff.sessionId!

      // Corrupt the on-disk state — schema-skewed shape that would have
      // sneaked through `as CurateSessionState`. The type guard treats
      // it as "no session" so the placeholder doesn't proceed with
      // garbage fields.
      const statePath = join(
        projectRoot,
        BRV_DIR,
        CURATE_SESSIONS_DIR,
        `${CURATE_SESSION_PREFIX}${sessionId}`,
        'state.json',
      )
      await writeFile(statePath, JSON.stringify({totally: 'wrong shape'}), 'utf8')

      const envelope = await continueSession({projectRoot, response: 'x', sessionId})
      expect(envelope.status).to.equal('failed')
      expect(envelope.errors![0].kind).to.equal('unknown-session')
    })

    it('treats unparseable state.json (truncated write) as no session', async () => {
      const kickoff = await kickoffSession({content: 'x', projectRoot})
      const sessionId = kickoff.sessionId!

      const statePath = join(
        projectRoot,
        BRV_DIR,
        CURATE_SESSIONS_DIR,
        `${CURATE_SESSION_PREFIX}${sessionId}`,
        'state.json',
      )
      await writeFile(statePath, '{ this is not json', 'utf8')

      const envelope = await continueSession({projectRoot, response: 'x', sessionId})
      expect(envelope.status).to.equal('failed')
      expect(envelope.errors![0].kind).to.equal('unknown-session')
    })
  })

  describe('resolveProjectRoot', () => {
    it('returns the directory that contains the .brv/ marker when called from a subdirectory', async () => {
      const project = await mkdtemp(join(tmpdir(), 'curate-session-root-'))
      try {
        await mkdir(join(project, BRV_DIR), {recursive: true})
        const nested = join(project, 'src', 'agent')
        await mkdir(nested, {recursive: true})

        expect(resolveProjectRoot(nested)).to.equal(project)
      } finally {
        await rm(project, {force: true, recursive: true})
      }
    })

    it('returns the input directory itself when it contains .brv/', async () => {
      const project = await mkdtemp(join(tmpdir(), 'curate-session-root-'))
      try {
        await mkdir(join(project, BRV_DIR), {recursive: true})
        expect(resolveProjectRoot(project)).to.equal(project)
      } finally {
        await rm(project, {force: true, recursive: true})
      }
    })

    it('falls back to the start directory when no .brv/ marker is found upward', async () => {
      // A fresh tmpdir with no .brv/ anywhere upward should fall back to
      // the start path — matches today's curate behavior of creating
      // .brv/ alongside cwd on first use.
      const project = await mkdtemp(join(tmpdir(), 'curate-session-no-brv-'))
      try {
        expect(resolveProjectRoot(project)).to.equal(project)
      } finally {
        await rm(project, {force: true, recursive: true})
      }
    })
  })

  describe('envelope contract (matches docs/curate-protocol.md)', () => {
    it('needs-llm-step envelope carries sessionId, step, prompt; not filePath or errors', async () => {
      const envelope = await kickoffSession({content: 'x', projectRoot})

      // Present
      expect(envelope.sessionId).to.be.a('string')
      expect(envelope.step).to.equal('generate-html')
      expect(envelope.prompt).to.be.a('string')

      // Absent
      expect(envelope.filePath).to.equal(undefined)
      expect(envelope.errors).to.equal(undefined)
    })

    it('done envelope carries filePath; not sessionId, step, prompt, or errors', async () => {
      const kickoff = await kickoffSession({content: 'x', projectRoot})
      const envelope = await continueSession({
        projectRoot,
        response: VALID_TOPIC_HTML,
        sessionId: kickoff.sessionId!,
      })

      // Present
      expect(envelope.filePath).to.be.a('string')

      // Absent
      expect(envelope.sessionId).to.equal(undefined)
      expect(envelope.step).to.equal(undefined)
      expect(envelope.prompt).to.equal(undefined)
      expect(envelope.errors).to.equal(undefined)
    })

    it('failed envelope carries errors[]; status === failed; ok === false', async () => {
      const envelope = await continueSession({
        projectRoot,
        response: 'x',
        sessionId: '00000000-0000-0000-0000-000000000000',
      })

      expect(envelope.ok).to.equal(false)
      expect(envelope.status).to.equal('failed')
      expect(envelope.errors).to.be.an('array').with.length.greaterThan(0)
    })
  })
})
