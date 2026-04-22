import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {HarnessVersion} from '../../../../src/agent/core/domain/harness/types.js'
import type {IHarnessStore} from '../../../../src/agent/core/interfaces/i-harness-store.js'

import {
  resolveVersionRef,
  VersionRefError,
} from '../../../../src/oclif/lib/resolve-version-ref.js'

const PROJECT_ID = '/fixture/proj'
const COMMAND_TYPE = 'curate'

function makeVersion(overrides: Partial<HarnessVersion> = {}): HarnessVersion {
  return {
    code: 'exports.curate = async () => {}',
    commandType: COMMAND_TYPE,
    createdAt: 1_700_000_000_000,
    heuristic: 0.5,
    id: 'v-default',
    metadata: {
      capabilities: ['curate'],
      commandType: COMMAND_TYPE,
      projectPatterns: ['**/*'],
      version: 1,
    },
    projectId: PROJECT_ID,
    projectType: 'generic',
    version: 1,
    ...overrides,
  }
}

function makeStoreStub(sb: SinonSandbox): IHarnessStore {
  return {
    deleteOutcome: sb.stub(),
    deleteOutcomes: sb.stub(),
    deleteScenario: sb.stub(),
    getLatest: sb.stub(),
    getVersion: sb.stub(),
    listOutcomes: sb.stub(),
    listScenarios: sb.stub(),
    listVersions: sb.stub(),
    pruneOldVersions: sb.stub(),
    recordFeedback: sb.stub(),
    saveOutcome: sb.stub(),
    saveScenario: sb.stub(),
    saveVersion: sb.stub(),
  } satisfies IHarnessStore
}

describe('resolveVersionRef', () => {
  let sb: SinonSandbox

  beforeEach(() => {
    sb = createSandbox()
  })

  afterEach(() => {
    sb.restore()
  })

  it('1. resolves "latest" to the result of getLatest', async () => {
    const store = makeStoreStub(sb)
    const latest = makeVersion({id: 'v-L', version: 7})
    ;(store.getLatest as SinonStub).resolves(latest)

    const out = await resolveVersionRef('latest', PROJECT_ID, COMMAND_TYPE, store)

    expect(out.versionId).to.equal('v-L')
    expect(out.version.version).to.equal(7)
  })

  it('2. "latest" with no versions throws NO_VERSIONS', async () => {
    const store = makeStoreStub(sb)
    ;(store.getLatest as SinonStub).resolves()

    let caught: unknown
    try {
      await resolveVersionRef('latest', PROJECT_ID, COMMAND_TYPE, store)
    } catch (error) {
      caught = error
    }

    expect(caught).to.be.instanceOf(VersionRefError)
    expect((caught as VersionRefError).code).to.equal('NO_VERSIONS')
  })

  it('3. "best" returns the highest-H version', async () => {
    const store = makeStoreStub(sb)
    ;(store.listVersions as SinonStub).resolves([
      makeVersion({heuristic: 0.3, id: 'v-low', version: 3}),
      makeVersion({heuristic: 0.9, id: 'v-top', version: 2}),
      makeVersion({heuristic: 0.5, id: 'v-mid', version: 1}),
    ])

    const out = await resolveVersionRef('best', PROJECT_ID, COMMAND_TYPE, store)

    expect(out.versionId).to.equal('v-top')
  })

  it('4. "best" ties broken by newest createdAt', async () => {
    const store = makeStoreStub(sb)
    ;(store.listVersions as SinonStub).resolves([
      makeVersion({createdAt: 100, heuristic: 0.7, id: 'v-old', version: 1}),
      makeVersion({createdAt: 500, heuristic: 0.7, id: 'v-new', version: 2}),
      makeVersion({createdAt: 300, heuristic: 0.7, id: 'v-mid', version: 3}),
    ])

    const out = await resolveVersionRef('best', PROJECT_ID, COMMAND_TYPE, store)

    expect(out.versionId).to.equal('v-new')
  })

  it('5. "best" with no versions throws NO_VERSIONS', async () => {
    const store = makeStoreStub(sb)
    ;(store.listVersions as SinonStub).resolves([])

    let caught: unknown
    try {
      await resolveVersionRef('best', PROJECT_ID, COMMAND_TYPE, store)
    } catch (error) {
      caught = error
    }

    expect(caught).to.be.instanceOf(VersionRefError)
    expect((caught as VersionRefError).code).to.equal('NO_VERSIONS')
  })

  it('6. "v3" returns the version whose version number equals 3', async () => {
    const store = makeStoreStub(sb)
    ;(store.listVersions as SinonStub).resolves([
      makeVersion({id: 'v-a', version: 1}),
      makeVersion({id: 'v-b', version: 2}),
      makeVersion({id: 'v-c', version: 3}),
    ])

    const out = await resolveVersionRef('v3', PROJECT_ID, COMMAND_TYPE, store)

    expect(out.versionId).to.equal('v-c')
    expect(out.version.version).to.equal(3)
  })

  it('7. "v99" returns NOT_FOUND with a hint about available versions', async () => {
    const store = makeStoreStub(sb)
    ;(store.listVersions as SinonStub).resolves([
      makeVersion({id: 'v-a', version: 1}),
      makeVersion({id: 'v-b', version: 2}),
    ])

    let caught: unknown
    try {
      await resolveVersionRef('v99', PROJECT_ID, COMMAND_TYPE, store)
    } catch (error) {
      caught = error
    }

    expect(caught).to.be.instanceOf(VersionRefError)
    expect((caught as VersionRefError).code).to.equal('NOT_FOUND')
    expect((caught as VersionRefError).message).to.include('#1')
    expect((caught as VersionRefError).message).to.include('#2')
  })

  it('8. "v0" is invalid grammar', async () => {
    const store = makeStoreStub(sb)

    let caught: unknown
    try {
      await resolveVersionRef('v0', PROJECT_ID, COMMAND_TYPE, store)
    } catch (error) {
      caught = error
    }

    expect(caught).to.be.instanceOf(VersionRefError)
    expect((caught as VersionRefError).code).to.equal('INVALID_GRAMMAR')
  })

  it('9. raw id resolves via getVersion', async () => {
    const store = makeStoreStub(sb)
    const v = makeVersion({id: 'v-raw-123', version: 5})
    ;(store.getVersion as SinonStub).resolves(v)

    const out = await resolveVersionRef('v-raw-123', PROJECT_ID, COMMAND_TYPE, store)

    expect(out.versionId).to.equal('v-raw-123')
  })

  it('10. raw id miss throws NOT_FOUND and names the ref', async () => {
    const store = makeStoreStub(sb)
    ;(store.getVersion as SinonStub).resolves()

    let caught: unknown
    try {
      await resolveVersionRef('v-unknown', PROJECT_ID, COMMAND_TYPE, store)
    } catch (error) {
      caught = error
    }

    expect(caught).to.be.instanceOf(VersionRefError)
    expect((caught as VersionRefError).code).to.equal('NOT_FOUND')
    expect((caught as VersionRefError).message).to.include('v-unknown')
  })

  it('11. "v1.5" falls through to raw-id lookup (not v<N>)', async () => {
    const store = makeStoreStub(sb)
    const getVersion = store.getVersion as SinonStub
    getVersion.resolves()

    try {
      await resolveVersionRef('v1.5', PROJECT_ID, COMMAND_TYPE, store)
    } catch {
      // Expected — getVersion miss
    }

    expect(getVersion.calledOnceWith(PROJECT_ID, COMMAND_TYPE, 'v1.5')).to.equal(true)
  })
})
