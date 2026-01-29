import {expect} from 'chai'
import {homedir, platform} from 'node:os'
import {join, sep} from 'node:path'

import {getGlobalDataDir} from '../../../src/server/utils/global-data-path.js'

describe('global-data-path', () => {
  describe('getGlobalDataDir()', () => {
    const currentPlatform = platform()

    it('should return an absolute path', () => {
      const result = getGlobalDataDir()

      // On all platforms, the path should start with root
      expect(result).to.satisfy(
        (p: string) =>
          // Windows: starts with drive letter (C:\)
          // Unix: starts with /
          p.startsWith(sep) || /^[A-Za-z]:/.test(p),
      )
    })

    it('should end with the brv directory', () => {
      const result = getGlobalDataDir()

      expect(result).to.match(/brv$/)
    })

    if (currentPlatform === 'darwin') {
      it('should return ~/.local/share/brv on macOS', () => {
        const expected = join(homedir(), '.local', 'share', 'brv')
        const result = getGlobalDataDir()

        expect(result).to.equal(expected)
      })
    }

    if (currentPlatform === 'linux') {
      describe('XDG_DATA_HOME support', () => {
        let originalXdgDataHome: string | undefined

        beforeEach(() => {
          originalXdgDataHome = process.env.XDG_DATA_HOME
        })

        afterEach(() => {
          if (originalXdgDataHome === undefined) {
            delete process.env.XDG_DATA_HOME
          } else {
            process.env.XDG_DATA_HOME = originalXdgDataHome
          }
        })

        it('should use XDG_DATA_HOME when set on Linux', () => {
          const customDataDir = '/custom/data'
          process.env.XDG_DATA_HOME = customDataDir

          const result = getGlobalDataDir()

          expect(result).to.equal(join(customDataDir, 'brv'))
        })

        it('should fallback to ~/.local/share/brv when XDG_DATA_HOME is not set on Linux', () => {
          delete process.env.XDG_DATA_HOME

          const expected = join(homedir(), '.local', 'share', 'brv')
          const result = getGlobalDataDir()

          expect(result).to.equal(expected)
        })
      })
    }

    if (currentPlatform === 'win32') {
      describe('Windows LOCALAPPDATA support', () => {
        let originalLocalAppData: string | undefined

        beforeEach(() => {
          originalLocalAppData = process.env.LOCALAPPDATA
        })

        afterEach(() => {
          if (originalLocalAppData === undefined) {
            delete process.env.LOCALAPPDATA
          } else {
            process.env.LOCALAPPDATA = originalLocalAppData
          }
        })

        it('should use LOCALAPPDATA when set on Windows', () => {
          const localAppDataDir = String.raw`C:\Users\Test\AppData\Local`
          process.env.LOCALAPPDATA = localAppDataDir

          const result = getGlobalDataDir()

          expect(result).to.equal(join(localAppDataDir, 'brv'))
        })

        it('should fallback to home/AppData/Local/brv when LOCALAPPDATA is not set', () => {
          delete process.env.LOCALAPPDATA

          const expected = join(homedir(), 'AppData', 'Local', 'brv')
          const result = getGlobalDataDir()

          expect(result).to.equal(expected)
        })
      })
    }
  })
})
