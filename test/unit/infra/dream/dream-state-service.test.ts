import {expect} from 'chai'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {DreamState} from '../../../../src/server/infra/dream/dream-state-schema.js'

import {DreamStateService} from '../../../../src/server/infra/dream/dream-state-service.js'

function makeState(overrides: Partial<DreamState> = {}): DreamState {
  return {
    curationsSinceDream: 0,
    lastDreamAt: null,
    lastDreamLogId: null,
    pendingMerges: [],
    totalDreams: 0,
    version: 1,
    ...overrides,
  }
}

describe('DreamStateService', () => {
  let tempDir: string
  let service: DreamStateService

  beforeEach(async () => {
    tempDir = join(tmpdir(), `brv-dream-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tempDir, {recursive: true})
    service = new DreamStateService({baseDir: tempDir})
  })

  afterEach(async () => {
    await rm(tempDir, {force: true, recursive: true})
  })

  // ==========================================================================
  // read
  // ==========================================================================

  describe('read', () => {
    it('should return EMPTY_DREAM_STATE when no file exists', async () => {
      const state = await service.read()
      expect(state).to.deep.equal(makeState())
    })

    it('should return persisted state', async () => {
      const expected = makeState({curationsSinceDream: 5, totalDreams: 2})
      await service.write(expected)

      const state = await service.read()
      expect(state).to.deep.equal(expected)
    })

    it('should return EMPTY_DREAM_STATE on corrupt JSON', async () => {
      await writeFile(join(tempDir, 'dream-state.json'), 'not valid json {{{', 'utf8')

      const state = await service.read()
      expect(state).to.deep.equal(makeState())
    })

    it('should return EMPTY_DREAM_STATE on valid JSON but wrong schema', async () => {
      await writeFile(join(tempDir, 'dream-state.json'), JSON.stringify({bad: true, version: 99}), 'utf8')

      const state = await service.read()
      expect(state).to.deep.equal(makeState())
    })
  })

  // ==========================================================================
  // write
  // ==========================================================================

  describe('write', () => {
    it('should persist state to disk', async () => {
      const state = makeState({lastDreamAt: '2026-04-10T12:00:00.000Z', totalDreams: 3})
      await service.write(state)

      const raw = await readFile(join(tempDir, 'dream-state.json'), 'utf8')
      const parsed = JSON.parse(raw)
      expect(parsed.totalDreams).to.equal(3)
      expect(parsed.lastDreamAt).to.equal('2026-04-10T12:00:00.000Z')
    })

    it('should create parent directory if missing', async () => {
      const nestedDir = join(tempDir, 'nested', 'deep')
      const nestedService = new DreamStateService({baseDir: nestedDir})

      await nestedService.write(makeState())
      const state = await nestedService.read()
      expect(state).to.deep.equal(makeState())
    })

    it('should use atomic write (no tmp files left)', async () => {
      await service.write(makeState())

      const {readdir} = await import('node:fs/promises')
      const files = await readdir(tempDir)
      const tmpFiles = files.filter(f => f.endsWith('.tmp'))
      expect(tmpFiles).to.have.lengthOf(0)
    })

    it('should reject invalid state', async () => {
      const badState = {...makeState(), version: 99} as unknown as DreamState
      try {
        await service.write(badState)
        expect.fail('should have thrown')
      } catch {
        // expected
      }
    })
  })

  // ==========================================================================
  // incrementCurationCount
  // ==========================================================================

  describe('incrementCurationCount', () => {
    it('should increment from 0 to 1', async () => {
      await service.incrementCurationCount()
      const state = await service.read()
      expect(state.curationsSinceDream).to.equal(1)
    })

    it('should increment 3 times to 3', async () => {
      await service.incrementCurationCount()
      await service.incrementCurationCount()
      await service.incrementCurationCount()
      const state = await service.read()
      expect(state.curationsSinceDream).to.equal(3)
    })

    it('should preserve other fields when incrementing', async () => {
      const initial = makeState({
        lastDreamAt: '2026-04-10T12:00:00.000Z',
        lastDreamLogId: 'drm-123',
        totalDreams: 5,
      })
      await service.write(initial)

      await service.incrementCurationCount()
      const state = await service.read()
      expect(state.curationsSinceDream).to.equal(1)
      expect(state.totalDreams).to.equal(5)
      expect(state.lastDreamLogId).to.equal('drm-123')
    })
  })
})
