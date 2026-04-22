import {expect} from 'chai'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {FileContent} from '../../../../src/agent/core/domain/file-system/types.js'
import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'

import {detectProjectType} from '../../../../src/agent/infra/harness/project-detector.js'

const CWD = '/proj'

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

describe('detectProjectType', () => {
  let sb: SinonSandbox

  beforeEach(() => {
    sb = createSandbox()
  })

  afterEach(() => {
    sb.restore()
  })

  it('returns [typescript] when only tsconfig.json is present', async () => {
    const {fileSystem} = makeFileSystem(sb, {[join(CWD, 'tsconfig.json')]: '{}'})
    const result = await detectProjectType(CWD, fileSystem)
    expect(result).to.deep.equal({detected: ['typescript']})
  })

  it('returns [python] when only pyproject.toml is present', async () => {
    const {fileSystem} = makeFileSystem(sb, {[join(CWD, 'pyproject.toml')]: '[project]\nname="x"\n'})
    const result = await detectProjectType(CWD, fileSystem)
    expect(result).to.deep.equal({detected: ['python']})
  })

  it('returns [typescript, python] when both TS and Python signals fire (polyglot)', async () => {
    const {fileSystem} = makeFileSystem(sb, {
      [join(CWD, 'pyproject.toml')]: '[project]\nname="x"\n',
      [join(CWD, 'tsconfig.json')]: '{}',
    })
    const result = await detectProjectType(CWD, fileSystem)
    expect(result).to.deep.equal({detected: ['typescript', 'python']})
  })

  it('returns [generic] when no signals fire', async () => {
    const {fileSystem} = makeFileSystem(sb, {})
    const result = await detectProjectType(CWD, fileSystem)
    expect(result).to.deep.equal({detected: ['generic']})
  })

  it('returns [python] when only setup.py is present', async () => {
    const {fileSystem} = makeFileSystem(sb, {
      [join(CWD, 'setup.py')]: 'from setuptools import setup\n',
    })
    const result = await detectProjectType(CWD, fileSystem)
    expect(result).to.deep.equal({detected: ['python']})
  })

  it('returns [python] when only setup.cfg is present', async () => {
    const {fileSystem} = makeFileSystem(sb, {[join(CWD, 'setup.cfg')]: '[metadata]\nname=x\n'})
    const result = await detectProjectType(CWD, fileSystem)
    expect(result).to.deep.equal({detected: ['python']})
  })

  it('returns [typescript] when package.json declares typescript but tsconfig.json is absent', async () => {
    const {fileSystem} = makeFileSystem(sb, {
      [join(CWD, 'package.json')]: JSON.stringify({devDependencies: {typescript: '^5.0.0'}}),
    })
    const result = await detectProjectType(CWD, fileSystem)
    expect(result).to.deep.equal({detected: ['typescript']})
  })

  it('deduplicates when both tsconfig.json and package.json TS dep fire', async () => {
    const {fileSystem} = makeFileSystem(sb, {
      [join(CWD, 'package.json')]: JSON.stringify({dependencies: {typescript: '^5.0.0'}}),
      [join(CWD, 'tsconfig.json')]: '{}',
    })
    const result = await detectProjectType(CWD, fileSystem)
    expect(result).to.deep.equal({detected: ['typescript']})
  })

  // ── Additional safety checks beyond the 7 enumerated scenarios ──────────

  it('does not treat package.json without a typescript dep as a TypeScript signal', async () => {
    const {fileSystem} = makeFileSystem(sb, {
      [join(CWD, 'package.json')]: JSON.stringify({dependencies: {lodash: '^4.0.0'}}),
    })
    const result = await detectProjectType(CWD, fileSystem)
    expect(result).to.deep.equal({detected: ['generic']})
  })

  it('treats a corrupt package.json as no TypeScript signal (does not throw)', async () => {
    const {fileSystem} = makeFileSystem(sb, {[join(CWD, 'package.json')]: 'not valid json {{{'})
    const result = await detectProjectType(CWD, fileSystem)
    expect(result).to.deep.equal({detected: ['generic']})
  })

  it('runs filesystem probes in parallel', async () => {
    const {fileSystem, readFileStub} = makeFileSystem(sb, {[join(CWD, 'tsconfig.json')]: '{}'})
    await detectProjectType(CWD, fileSystem)
    // 5 parallel readFile calls: tsconfig, package.json, pyproject, setup.py, setup.cfg
    expect(readFileStub.callCount).to.equal(5)
  })
})
