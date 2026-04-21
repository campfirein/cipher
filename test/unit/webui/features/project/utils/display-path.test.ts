import {expect} from 'chai'

import {displayPath} from '../../../../../../src/webui/features/project/utils/display-path'

describe('displayPath', () => {
  describe('macOS home', () => {
    it('replaces /Users/<user>/ with ~/', () => {
      expect(displayPath('/Users/thien/projects/foo')).to.equal('~/projects/foo')
    })

    it('replaces deep paths under any user', () => {
      expect(displayPath('/Users/alice/work/client/app')).to.equal('~/work/client/app')
    })

    it('leaves the home dir itself alone (no trailing slash)', () => {
      expect(displayPath('/Users/thien')).to.equal('/Users/thien')
    })
  })

  describe('Linux home', () => {
    it('replaces /home/<user>/ with ~/', () => {
      expect(displayPath('/home/thien/projects/foo')).to.equal('~/projects/foo')
    })

    it('handles usernames with dots', () => {
      expect(displayPath('/home/thien.dev/proj')).to.equal('~/proj')
    })

    it('leaves the home dir itself alone (no trailing slash)', () => {
      expect(displayPath('/home/thien')).to.equal('/home/thien')
    })
  })

  describe('Windows home', () => {
    it('replaces C:\\Users\\<user>\\ with ~\\', () => {
      expect(displayPath(String.raw`C:\Users\thien\projects\foo`)).to.equal(String.raw`~\projects\foo`)
    })

    it('handles forward-slash Windows paths', () => {
      expect(displayPath('C:/Users/thien/projects/foo')).to.equal('~/projects/foo')
    })

    it('handles drive letters other than C', () => {
      expect(displayPath(String.raw`D:\Users\thien\work`)).to.equal(String.raw`~\work`)
    })

    it('leaves the home dir itself alone (no trailing separator)', () => {
      expect(displayPath(String.raw`C:\Users\thien`)).to.equal(String.raw`C:\Users\thien`)
    })
  })

  describe('paths outside any home dir', () => {
    it('returns the path unchanged for /tmp', () => {
      expect(displayPath('/tmp/foo')).to.equal('/tmp/foo')
    })

    it('returns the path unchanged for a Windows work drive', () => {
      expect(displayPath(String.raw`D:\work\proj`)).to.equal(String.raw`D:\work\proj`)
    })

    it('returns the path unchanged for a Windows UNC share (no drive letter)', () => {
      expect(displayPath(String.raw`\\server\share\folder`)).to.equal(String.raw`\\server\share\folder`)
    })

    it('returns the path unchanged for filesystem root', () => {
      expect(displayPath('/')).to.equal('/')
    })

    it('returns an empty string unchanged', () => {
      expect(displayPath('')).to.equal('')
    })
  })
})
