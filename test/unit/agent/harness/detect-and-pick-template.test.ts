import {expect} from 'chai'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {FileContent} from '../../../../src/agent/core/domain/file-system/types.js'
import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'
import type {ILogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'

import {
  _clearPolyglotWarningState,
  detectAndPickTemplate,
} from '../../../../src/agent/infra/harness/detect-and-pick-template.js'

type FilePresence = {
  readonly [filename: string]: string | undefined
}

function makeFileSystem(
  sb: SinonSandbox,
  files: FilePresence,
): {readonly fileSystem: IFileSystem; readonly readFileStub: SinonStub} {
  const readFileStub = sb.stub()
  readFileStub.callsFake(async (filePath: string): Promise<FileContent> => {
    const content = files[filePath]
    if (content === undefined) throw new Error(`ENOENT: ${filePath}`)
    return {
      content,
      encoding: 'utf8',
      formattedContent: content,
      lines: 1,
      message: '',
      size: content.length,
      totalLines: 1,
      truncated: false,
    }
  })

  const fileSystem = {
    editFile: sb.stub(),
    globFiles: sb.stub(),
    initialize: sb.stub(),
    listDirectory: sb.stub(),
    readFile: readFileStub,
    searchContent: sb.stub(),
    writeFile: sb.stub(),
  } satisfies IFileSystem

  return {fileSystem, readFileStub}
}

function makeLogger(sb: SinonSandbox): ILogger & {
  readonly debug: SinonStub
  readonly error: SinonStub
  readonly info: SinonStub
  readonly warn: SinonStub
} {
  return {
    debug: sb.stub(),
    error: sb.stub(),
    info: sb.stub(),
    warn: sb.stub(),
  }
}

function makeConfig(overrides: Partial<ValidatedHarnessConfig> = {}): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    language: 'auto',
    maxVersions: 20,
    ...overrides,
  }
}

// A filesystem whose `readFile` throws if invoked — used to prove the
// override path does NOT call the detector. Guards against a future
// "detect anyway for telemetry" refactor slipping in silently.
function makeExplodingFileSystem(sb: SinonSandbox): IFileSystem {
  const readFileStub = sb.stub()
  readFileStub.callsFake(() => {
    throw new Error('detector must NOT be called when config.language is a concrete override')
  })
  return {
    editFile: sb.stub(),
    globFiles: sb.stub(),
    initialize: sb.stub(),
    listDirectory: sb.stub(),
    readFile: readFileStub,
    searchContent: sb.stub(),
    writeFile: sb.stub(),
  } satisfies IFileSystem
}

const CWD_A = '/proj-a'
const CWD_B = '/proj-b'

describe('detectAndPickTemplate', () => {
  let sb: SinonSandbox

  beforeEach(() => {
    sb = createSandbox()
    _clearPolyglotWarningState()
  })

  afterEach(() => {
    sb.restore()
    _clearPolyglotWarningState()
  })

  // ── Override branch: config.language wins, no detection runs ──────────────

  it('1. config.language=typescript → returns typescript without calling detector', async () => {
    const fs = makeExplodingFileSystem(sb)
    const logger = makeLogger(sb)
    const result = await detectAndPickTemplate(CWD_A, fs, makeConfig({language: 'typescript'}), logger)
    expect(result).to.equal('typescript')
    expect(logger.warn.callCount).to.equal(0)
  })

  it('2. config.language=generic → returns generic without calling detector', async () => {
    const fs = makeExplodingFileSystem(sb)
    const logger = makeLogger(sb)
    const result = await detectAndPickTemplate(CWD_A, fs, makeConfig({language: 'generic'}), logger)
    expect(result).to.equal('generic')
    expect(logger.warn.callCount).to.equal(0)
  })

  it('9. config.language=python overrides tsconfig-only repo', async () => {
    const fs = makeExplodingFileSystem(sb)
    const logger = makeLogger(sb)
    // The fs is exploding — the test passes only if the detector is never called.
    const result = await detectAndPickTemplate(CWD_A, fs, makeConfig({language: 'python'}), logger)
    expect(result).to.equal('python')
  })

  // ── Auto branch: single-detection pass-through ────────────────────────────

  it('3. auto + [typescript] → returns typescript', async () => {
    const {fileSystem} = makeFileSystem(sb, {[join(CWD_A, 'tsconfig.json')]: '{}'})
    const logger = makeLogger(sb)
    const result = await detectAndPickTemplate(CWD_A, fileSystem, makeConfig(), logger)
    expect(result).to.equal('typescript')
    expect(logger.warn.callCount).to.equal(0)
  })

  it('4. auto + [python] → returns python', async () => {
    const {fileSystem} = makeFileSystem(sb, {[join(CWD_A, 'pyproject.toml')]: '[project]\n'})
    const logger = makeLogger(sb)
    const result = await detectAndPickTemplate(CWD_A, fileSystem, makeConfig(), logger)
    expect(result).to.equal('python')
    expect(logger.warn.callCount).to.equal(0)
  })

  it('8. auto + [generic] → returns generic with no warning', async () => {
    const {fileSystem} = makeFileSystem(sb, {})
    const logger = makeLogger(sb)
    const result = await detectAndPickTemplate(CWD_A, fileSystem, makeConfig(), logger)
    expect(result).to.equal('generic')
    expect(logger.warn.callCount).to.equal(0)
  })

  // ── Auto branch: polyglot → generic + warn-once ───────────────────────────

  it('5. auto + polyglot [typescript, python] → returns generic with warn containing both types', async () => {
    const {fileSystem} = makeFileSystem(sb, {
      [join(CWD_A, 'pyproject.toml')]: '[project]\n',
      [join(CWD_A, 'tsconfig.json')]: '{}',
    })
    const logger = makeLogger(sb)
    const result = await detectAndPickTemplate(CWD_A, fileSystem, makeConfig(), logger)
    expect(result).to.equal('generic')
    expect(logger.warn.callCount).to.equal(1)
    const [message] = logger.warn.firstCall.args
    expect(message).to.include('typescript')
    expect(message).to.include('python')
    // Warn message must spell out the override path — the user has no other
    // discoverable way to silence it.
    expect(message).to.include('config.harness.language')
  })

  it('6. warn fires once per workingDirectory; second call logs debug', async () => {
    const {fileSystem} = makeFileSystem(sb, {
      [join(CWD_A, 'pyproject.toml')]: '[project]\n',
      [join(CWD_A, 'tsconfig.json')]: '{}',
    })
    const logger = makeLogger(sb)

    await detectAndPickTemplate(CWD_A, fileSystem, makeConfig(), logger)
    await detectAndPickTemplate(CWD_A, fileSystem, makeConfig(), logger)

    expect(logger.warn.callCount).to.equal(1)
    // Second hit logs debug instead of warn. Other debug calls (e.g. from
    // the override branch) don't apply because we're in the auto branch.
    expect(logger.debug.callCount).to.equal(1)
  })

  it('7. warn fires again for a different workingDirectory', async () => {
    const fsA = makeFileSystem(sb, {
      [join(CWD_A, 'pyproject.toml')]: '[project]\n',
      [join(CWD_A, 'tsconfig.json')]: '{}',
    })
    const fsB = makeFileSystem(sb, {
      [join(CWD_B, 'pyproject.toml')]: '[project]\n',
      [join(CWD_B, 'tsconfig.json')]: '{}',
    })
    const logger = makeLogger(sb)

    await detectAndPickTemplate(CWD_A, fsA.fileSystem, makeConfig(), logger)
    await detectAndPickTemplate(CWD_B, fsB.fileSystem, makeConfig(), logger)

    expect(logger.warn.callCount).to.equal(2)
  })
})
