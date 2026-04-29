import {expect} from 'chai'

import {resolveRevealCommand} from '../../../../src/server/infra/transport/handlers/reveal-command.js'

describe('resolveRevealCommand', () => {
  const path = '/Users/wzlng/Documents/work/byterover-cli'

  it('returns the macOS "open" command on darwin', () => {
    expect(resolveRevealCommand('darwin', path)).to.deep.equal({args: [path], command: 'open'})
  })

  it('returns Windows "explorer" on win32', () => {
    expect(resolveRevealCommand('win32', path)).to.deep.equal({args: [path], command: 'explorer'})
  })

  it('falls back to xdg-open on linux', () => {
    expect(resolveRevealCommand('linux', path)).to.deep.equal({args: [path], command: 'xdg-open'})
  })

  it('falls back to xdg-open on freebsd and other POSIX-like platforms', () => {
    expect(resolveRevealCommand('freebsd', path)).to.deep.equal({args: [path], command: 'xdg-open'})
    expect(resolveRevealCommand('openbsd', path)).to.deep.equal({args: [path], command: 'xdg-open'})
  })

  it('passes the target path through as the first argument without interpolation', () => {
    const hostile = '/tmp/dir with spaces/$(whoami)'
    const result = resolveRevealCommand('darwin', hostile)
    expect(result.args).to.deep.equal([hostile])
  })
})
