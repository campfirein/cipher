import {expect} from 'chai'
import {promises as fs} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {FileProfileMetadataStore} from '../../../../../src/server/infra/channel/profile-metadata-store.js'

// Slice 4.2 — local-only driver-profile metadata store.
//
// Lives at `<dataDir>/state/agent-driver-profile-metadata.json`. Keyed by
// profile name; each entry records the most recent probe error (currently
// only AUTH_REQUIRED) so doctor can surface KIMI_AUTH_STALE without
// touching the wire-spec `AgentDriverProfile` shape.

describe('FileProfileMetadataStore (Slice 4.2)', () => {
  let dataDir: string

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(join(tmpdir(), 'brv-profile-meta-'))
  })

  afterEach(async () => {
    await fs.rm(dataDir, {force: true, recursive: true})
  })

  it('returns undefined for missing entries (empty file)', async () => {
    const store = new FileProfileMetadataStore({dataDir})
    expect(await store.get('kimi')).to.equal(undefined)
  })

  it('setLastProbeError + get round-trips the record', async () => {
    const store = new FileProfileMetadataStore({dataDir})
    await store.setLastProbeError({
      at: '2026-05-12T00:00:00.000Z',
      error: 'AUTH_REQUIRED',
      name: 'kimi',
    })
    const record = await store.get('kimi')
    expect(record).to.deep.equal({lastProbeAt: '2026-05-12T00:00:00.000Z', lastProbeError: 'AUTH_REQUIRED'})
  })

  it('clearLastProbeError removes the record', async () => {
    const store = new FileProfileMetadataStore({dataDir})
    await store.setLastProbeError({at: '2026-05-12T00:00:00.000Z', error: 'AUTH_REQUIRED', name: 'kimi'})
    await store.clearLastProbeError('kimi')
    expect(await store.get('kimi')).to.equal(undefined)
  })

  it('keeps records for unrelated profiles when one is cleared', async () => {
    const store = new FileProfileMetadataStore({dataDir})
    await store.setLastProbeError({at: '2026-05-12T00:00:00.000Z', error: 'AUTH_REQUIRED', name: 'kimi'})
    await store.setLastProbeError({at: '2026-05-12T00:01:00.000Z', error: 'AUTH_REQUIRED', name: 'opencode'})
    await store.clearLastProbeError('kimi')
    expect(await store.get('kimi')).to.equal(undefined)
    expect(await store.get('opencode')).to.not.equal(undefined)
  })

  it('persists with mode 0600 + atomic rename (no .tmp leftovers)', async () => {
    const store = new FileProfileMetadataStore({dataDir})
    await store.setLastProbeError({at: '2026-05-12T00:00:00.000Z', error: 'AUTH_REQUIRED', name: 'kimi'})
    const path = join(dataDir, 'state', 'agent-driver-profile-metadata.json')
    const stat = await fs.stat(path)
    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o777).to.equal(0o600)

    const stateDir = join(dataDir, 'state')
    const entries = await fs.readdir(stateDir)
    expect(entries.filter((e) => e.includes('.tmp')), 'no .tmp leftovers').to.deep.equal([])
  })

  it('tolerates a corrupt or unparseable file (returns undefined)', async () => {
    const path = join(dataDir, 'state', 'agent-driver-profile-metadata.json')
    await fs.mkdir(join(dataDir, 'state'), {recursive: true})
    await fs.writeFile(path, '{not valid json', 'utf8')
    const store = new FileProfileMetadataStore({dataDir})
    expect(await store.get('kimi')).to.equal(undefined)
    // And subsequent writes recover by overwriting the corruption.
    await store.setLastProbeError({at: '2026-05-12T00:00:00.000Z', error: 'AUTH_REQUIRED', name: 'kimi'})
    expect(await store.get('kimi')).to.not.equal(undefined)
  })

  // Phase 10 Tier B3 (V6 run-3 §4a) — per-profile drift observations.
  describe('drift observations', () => {
    it('records a drift observation for a profile', async () => {
      const store = new FileProfileMetadataStore({dataDir})
      await store.addDriftObservation({
        description: 'used -100 vs spec -50 for off-screen cull',
        file: 'systems.js',
        line: 159,
        name: '@pi',
        observedAt: '2026-05-18T18:00:00.000Z',
      })
      const record = await store.get('@pi')
      expect(record?.driftObservations).to.have.lengthOf(1)
      expect(record?.driftObservations?.[0].file).to.equal('systems.js')
      expect(record?.driftObservations?.[0].line).to.equal(159)
      expect(record?.driftObservations?.[0].description).to.match(/cull/)
    })

    it('appends multiple observations in insertion order', async () => {
      const store = new FileProfileMetadataStore({dataDir})
      await store.addDriftObservation({
        description: 'first',
        file: 'a.js',
        line: 1,
        name: '@pi',
        observedAt: '2026-05-18T18:00:00.000Z',
      })
      await store.addDriftObservation({
        description: 'second',
        file: 'b.js',
        line: 2,
        name: '@pi',
        observedAt: '2026-05-18T18:01:00.000Z',
      })
      const record = await store.get('@pi')
      expect(record?.driftObservations?.map(o => o.description)).to.deep.equal(['first', 'second'])
    })

    it('omits line field when not provided', async () => {
      const store = new FileProfileMetadataStore({dataDir})
      await store.addDriftObservation({
        description: 'whole-file refactor concern',
        file: 'engine.js',
        name: '@codex',
        observedAt: '2026-05-18T18:00:00.000Z',
      })
      const obs = (await store.get('@codex'))?.driftObservations?.[0]
      expect(obs?.line).to.equal(undefined)
      expect(obs?.file).to.equal('engine.js')
    })

    it('clearDriftObservations removes the list but preserves probe state', async () => {
      const store = new FileProfileMetadataStore({dataDir})
      await store.setLastProbeError({at: '2026-05-18T18:00:00.000Z', error: 'AUTH_REQUIRED', name: '@kimi'})
      await store.addDriftObservation({
        description: 'finds it',
        file: 'x.js',
        line: 5,
        name: '@kimi',
        observedAt: '2026-05-18T18:00:00.000Z',
      })
      await store.clearDriftObservations('@kimi')
      const record = await store.get('@kimi')
      expect(record?.driftObservations).to.equal(undefined)
      expect(record?.lastProbeError, 'probe state preserved on drift clear').to.equal('AUTH_REQUIRED')
    })

    it('clearLastProbeError preserves drift observations (B3 cross-field safety)', async () => {
      const store = new FileProfileMetadataStore({dataDir})
      await store.setLastProbeError({at: '2026-05-18T18:00:00.000Z', error: 'AUTH_REQUIRED', name: '@kimi'})
      await store.addDriftObservation({
        description: 'persists across probe clears',
        file: 'x.js',
        name: '@kimi',
        observedAt: '2026-05-18T18:00:00.000Z',
      })
      await store.clearLastProbeError('@kimi')
      const record = await store.get('@kimi')
      expect(record?.lastProbeError).to.equal(undefined)
      expect(record?.driftObservations, 'drift observations survive probe clear').to.have.lengthOf(1)
    })

    it('setLastProbeError preserves existing drift observations (no clobber)', async () => {
      const store = new FileProfileMetadataStore({dataDir})
      await store.addDriftObservation({
        description: 'pre-existing',
        file: 'x.js',
        name: '@kimi',
        observedAt: '2026-05-18T18:00:00.000Z',
      })
      await store.setLastProbeError({at: '2026-05-18T19:00:00.000Z', error: 'AUTH_REQUIRED', name: '@kimi'})
      const record = await store.get('@kimi')
      expect(record?.driftObservations, 'drift observations survive probe-error set').to.have.lengthOf(1)
      expect(record?.lastProbeError).to.equal('AUTH_REQUIRED')
    })

    it('clearDriftObservations on an empty record is a no-op', async () => {
      const store = new FileProfileMetadataStore({dataDir})
      await store.clearDriftObservations('@never-seen')
      expect(await store.get('@never-seen')).to.equal(undefined)
    })

    it('clearDriftObservations removes the whole record when no other fields remain', async () => {
      const store = new FileProfileMetadataStore({dataDir})
      await store.addDriftObservation({
        description: 'sole field',
        file: 'x.js',
        name: '@pi',
        observedAt: '2026-05-18T18:00:00.000Z',
      })
      await store.clearDriftObservations('@pi')
      expect(await store.get('@pi'), 'empty record cleaned up').to.equal(undefined)
    })
  })
})
