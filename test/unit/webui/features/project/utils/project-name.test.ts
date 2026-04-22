import {expect} from 'chai'

import {getProjectName} from '../../../../../../src/webui/features/project/utils/project-name'

describe('getProjectName', () => {
  describe('Unix paths', () => {
    it('returns the leaf of an absolute Unix path', () => {
      expect(getProjectName('/Users/foo/proj')).to.equal('proj')
    })

    it('strips a trailing slash before taking the leaf', () => {
      expect(getProjectName('/Users/foo/proj/')).to.equal('proj')
    })

    it('strips multiple trailing slashes', () => {
      expect(getProjectName('/Users/foo/proj///')).to.equal('proj')
    })

    it('returns the leaf of a relative Unix path', () => {
      expect(getProjectName('./proj')).to.equal('proj')
      expect(getProjectName('../proj')).to.equal('proj')
    })

    it('preserves dotfile-style names', () => {
      expect(getProjectName('/Users/foo/.brv')).to.equal('.brv')
    })

    it('preserves spaces and unicode in the leaf', () => {
      expect(getProjectName('/Users/foo/My Project')).to.equal('My Project')
      expect(getProjectName('/Users/foo/проект')).to.equal('проект')
    })
  })

  describe('Windows paths', () => {
    it('returns the leaf of an absolute Windows path', () => {
      expect(getProjectName(String.raw`C:\Users\foo\proj`)).to.equal('proj')
    })

    it('strips a trailing backslash before taking the leaf', () => {
      expect(getProjectName('C:\\Users\\foo\\proj\\')).to.equal('proj')
    })

    it('handles Windows paths that use forward slashes', () => {
      expect(getProjectName('C:/Users/foo/proj')).to.equal('proj')
    })

    it('handles mixed separators', () => {
      expect(getProjectName(String.raw`C:\Users\foo/proj`)).to.equal('proj')
    })

    it('returns the leaf of a UNC share path', () => {
      expect(getProjectName(String.raw`\\server\share\folder`)).to.equal('folder')
    })
  })

  describe('degenerate inputs', () => {
    it('returns the original string when the input is empty', () => {
      expect(getProjectName('')).to.equal('')
    })

    it('returns the original string when the input is just a separator', () => {
      expect(getProjectName('/')).to.equal('/')
      expect(getProjectName('\\')).to.equal('\\')
    })

    it('returns the original string when the input is only separators', () => {
      expect(getProjectName('///')).to.equal('///')
    })

    it('returns the whole string when there are no separators', () => {
      expect(getProjectName('proj')).to.equal('proj')
    })
  })
})
