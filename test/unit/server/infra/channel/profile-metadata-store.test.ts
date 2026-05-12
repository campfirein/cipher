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
})
