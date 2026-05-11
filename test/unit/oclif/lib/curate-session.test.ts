/**
 * curate-session placeholder tests.
 *
 * TKT 01 ships a placeholder orchestrator that locks the wire protocol
 * before TKT 02's real state machine lands. The tests below pin:
 *
 *   - Kickoff returns a fresh sessionId and `needs-llm-step` envelope.
 *   - On-disk state is created at the documented path and survives
 *     read-back.
 *   - Continuation with a valid sessionId returns `done` and clears
 *     state.
 *   - Unknown sessionId returns `failed` with `kind: unknown-session`.
 *   - Empty continuation response returns `failed` with `kind:
 *     empty-response` and keeps the session live for retry.
 *   - Envelope shape matches `docs/curate-protocol.md` (presence
 *     /absence of each optional field per status).
 */

import {expect} from 'chai'
import {existsSync} from 'node:fs'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  continueSession,
  CURATE_SESSION_PREFIX,
  CURATE_SESSIONS_DIR,
  kickoffSession,
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

    it('writes on-disk state at the documented path', async () => {
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
      expect(state.createdAt).to.be.a('number')
    })

    it('two kickoffs against the same project return distinct sessionIds', async () => {
      const a = await kickoffSession({content: 'a', projectRoot})
      const b = await kickoffSession({content: 'b', projectRoot})

      expect(a.sessionId).to.not.equal(b.sessionId)
    })
  })

  describe('continueSession', () => {
    it('returns done and clears state on the first continuation', async () => {
      const kickoff = await kickoffSession({content: 'x', projectRoot})
      const sessionId = kickoff.sessionId!

      const envelope = await continueSession({
        projectRoot,
        response: '<bv-topic path="x" title="t"></bv-topic>',
        sessionId,
      })

      expect(envelope.ok).to.equal(true)
      expect(envelope.status).to.equal('done')
      expect(envelope.filePath).to.be.a('string')
      expect(envelope.filePath!).to.include(sessionId)

      const stateDir = join(
        projectRoot,
        BRV_DIR,
        CURATE_SESSIONS_DIR,
        `${CURATE_SESSION_PREFIX}${sessionId}`,
      )
      expect(existsSync(stateDir)).to.equal(false)
    })

    it('returns failed with unknown-session for an unknown sessionId', async () => {
      const envelope = await continueSession({
        projectRoot,
        response: 'anything',
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

      expect(envelope.ok).to.equal(false)
      expect(envelope.status).to.equal('failed')
      expect(envelope.errors![0].kind).to.equal('empty-response')
      // sessionId is still returned so the caller can retry
      expect(envelope.sessionId).to.equal(sessionId)

      // State directory must still exist — empty-response is a transient
      // error, the session is preserved for the next retry.
      const stateDir = join(
        projectRoot,
        BRV_DIR,
        CURATE_SESSIONS_DIR,
        `${CURATE_SESSION_PREFIX}${sessionId}`,
      )
      expect(existsSync(stateDir)).to.equal(true)
    })

    it('second continuation against the same sessionId returns unknown-session (state already cleared)', async () => {
      const kickoff = await kickoffSession({content: 'x', projectRoot})
      const sessionId = kickoff.sessionId!

      // First continuation succeeds and clears state
      await continueSession({projectRoot, response: '<bv-topic/>', sessionId})

      // Second continuation must fail — placeholder doesn't preserve done sessions
      const envelope = await continueSession({projectRoot, response: '<bv-topic/>', sessionId})

      expect(envelope.status).to.equal('failed')
      expect(envelope.errors![0].kind).to.equal('unknown-session')
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
        response: '<bv-topic/>',
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
