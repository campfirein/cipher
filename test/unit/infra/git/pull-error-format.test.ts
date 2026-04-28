import {expect} from 'chai'
import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVICE_PATH = resolve(__dirname, '../../../../src/server/infra/git/isomorphic-git-service.ts')

const OVERWRITE_REGEX =
  /^Your local changes to the following files would be overwritten by merge:\n(\t[^\n]+\n)+Please commit your changes before you merge\.$/

describe('pull overwrite error format (ENG-2516)', () => {
  it('production source carries the three native-git format anchors', () => {
    // Format-drift guard: if any of the three string anchors disappear from the
    // pull() error path, this test fails — even before runtime. Cheaper than a
    // full integration test that requires a real remote.
    const source = readFileSync(SERVICE_PATH, 'utf8')
    expect(source).to.include('Your local changes to the following files would be overwritten by merge:')
    // eslint-disable-next-line no-template-curly-in-string -- this string IS a literal source-code excerpt
    expect(source).to.include("overwrittenFiles.map((f) => `\\t${f}`).join('\\n')")
    expect(source).to.include('Please commit your changes before you merge.')
  })

  it('regex accepts the canonical well-formed message', () => {
    const message =
      'Your local changes to the following files would be overwritten by merge:\n' +
      '\tabcdef.md\n' +
      '\tnotes/log.md\n' +
      'Please commit your changes before you merge.'
    expect(OVERWRITE_REGEX.test(message)).to.equal(true)
  })

  it('regex rejects the pre-fix single-line message (catches accidental revert)', () => {
    const preFixMessage = 'Local changes would be overwritten by pull. Commit or discard your changes first.'
    expect(OVERWRITE_REGEX.test(preFixMessage)).to.equal(false)
  })

  it('regex rejects messages mentioning `stash` (brv has no stash command)', () => {
    const wrongMessage =
      'Your local changes to the following files would be overwritten by merge:\n' +
      '\tabcdef.md\n' +
      'Please commit your changes or stash them before you merge.'
    expect(OVERWRITE_REGEX.test(wrongMessage)).to.equal(false)
  })

  it('regex requires at least one file path (no empty file list)', () => {
    const noFilesMessage =
      'Your local changes to the following files would be overwritten by merge:\n' +
      'Please commit your changes before you merge.'
    expect(OVERWRITE_REGEX.test(noFilesMessage)).to.equal(false)
  })
})
