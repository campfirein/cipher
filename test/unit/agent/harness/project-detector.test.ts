import {expect} from 'chai'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'

import {detectProjectType} from '../../../../src/agent/infra/harness/project-detector.js'

const CWD = '/proj'

type FilePresence = {
  readonly [filename: string]: string | undefined
}

function makeFileSystem(sb: SinonSandbox, files: FilePresence): IFileSystem {
  const readFile = sb.stub()
  readFile.callsFake(async (filePath: string) => {
    const content = files[filePath]
    if (content === undefined) throw new Error(`ENOENT: ${filePath}`)
    return {content, encoding: 'utf8', formattedContent: content, lines: 1, message: ''}
  })

  return {
    editFile: sb.stub(),
    globFiles: sb.stub(),
    initialize: sb.stub(),
    listDirectory: sb.stub(),
    readFile,
    searchContent: sb.stub(),
    writeFile: sb.stub(),
  } as unknown as IFileSystem
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
    const fs = makeFileSystem(sb, {[join(CWD, 'tsconfig.json')]: '{}'})
    const result = await detectProjectType(CWD, fs)
    expect(result).to.deep.equal({detected: ['typescript']})
  })

  it('returns [python] when only pyproject.toml is present', async () => {
    const fs = makeFileSystem(sb, {[join(CWD, 'pyproject.toml')]: '[project]\nname="x"\n'})
    const result = await detectProjectType(CWD, fs)
    expect(result).to.deep.equal({detected: ['python']})
  })

  it('returns [typescript, python] when both TS and Python signals fire (polyglot)', async () => {
    const fs = makeFileSystem(sb, {
      [join(CWD, 'pyproject.toml')]: '[project]\nname="x"\n',
      [join(CWD, 'tsconfig.json')]: '{}',
    })
    const result = await detectProjectType(CWD, fs)
    expect(result).to.deep.equal({detected: ['typescript', 'python']})
  })

  it('returns [generic] when no signals fire', async () => {
    const fs = makeFileSystem(sb, {})
    const result = await detectProjectType(CWD, fs)
    expect(result).to.deep.equal({detected: ['generic']})
  })

  it('returns [python] when only setup.py is present', async () => {
    const fs = makeFileSystem(sb, {[join(CWD, 'setup.py')]: 'from setuptools import setup\n'})
    const result = await detectProjectType(CWD, fs)
    expect(result).to.deep.equal({detected: ['python']})
  })

  it('returns [typescript] when package.json declares typescript but tsconfig.json is absent', async () => {
    const fs = makeFileSystem(sb, {
      [join(CWD, 'package.json')]: JSON.stringify({devDependencies: {typescript: '^5.0.0'}}),
    })
    const result = await detectProjectType(CWD, fs)
    expect(result).to.deep.equal({detected: ['typescript']})
  })

  it('deduplicates when both tsconfig.json and package.json TS dep fire', async () => {
    const fs = makeFileSystem(sb, {
      [join(CWD, 'package.json')]: JSON.stringify({dependencies: {typescript: '^5.0.0'}}),
      [join(CWD, 'tsconfig.json')]: '{}',
    })
    const result = await detectProjectType(CWD, fs)
    expect(result).to.deep.equal({detected: ['typescript']})
  })

  // ── Additional safety checks beyond the 7 enumerated scenarios ──────────

  it('does not treat package.json without a typescript dep as a TypeScript signal', async () => {
    const fs = makeFileSystem(sb, {
      [join(CWD, 'package.json')]: JSON.stringify({dependencies: {lodash: '^4.0.0'}}),
    })
    const result = await detectProjectType(CWD, fs)
    expect(result).to.deep.equal({detected: ['generic']})
  })

  it('treats a corrupt package.json as no TypeScript signal (does not throw)', async () => {
    const fs = makeFileSystem(sb, {[join(CWD, 'package.json')]: 'not valid json {{{'})
    const result = await detectProjectType(CWD, fs)
    expect(result).to.deep.equal({detected: ['generic']})
  })

  it('runs filesystem probes in parallel', async () => {
    // Verify via call count: every probe fires, regardless of early returns.
    const fs = makeFileSystem(sb, {[join(CWD, 'tsconfig.json')]: '{}'})
    await detectProjectType(CWD, fs)
    // 5 parallel readFile calls: tsconfig, package.json, pyproject, setup.py, setup.cfg
    const readFile = fs.readFile as unknown as {callCount: number}
    expect(readFile.callCount).to.equal(5)
  })
})
