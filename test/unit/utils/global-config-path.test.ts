import {expect} from 'chai'
import {homedir, platform} from 'node:os'
import {join, sep} from 'node:path'

import {getGlobalConfigDir, getGlobalConfigPath} from '../../../src/utils/global-config-path.js'

describe('global-config-path', () => {
  describe('getGlobalConfigDir()', () => {
    const currentPlatform = platform()

    it('should return an absolute path', () => {
      const result = getGlobalConfigDir()

      // On all platforms, the path should start with root
      expect(result).to.satisfy(
        (p: string) =>
          // Windows: starts with drive letter (C:\)
          // Unix: starts with /
          p.startsWith(sep) || /^[A-Za-z]:/.test(p),
      )
    })

    it('should end with the brv directory', () => {
      const result = getGlobalConfigDir()

      expect(result).to.match(/brv$/)
    })

    if (currentPlatform === 'darwin') {
      it('should return ~/.config/brv on macOS', () => {
        const expected = join(homedir(), '.config', 'brv')
        const result = getGlobalConfigDir()

        expect(result).to.equal(expected)
      })
    }

    if (currentPlatform === 'linux') {
      describe('XDG_CONFIG_HOME support', () => {
        let originalXdgConfigHome: string | undefined

        beforeEach(() => {
          originalXdgConfigHome = process.env.XDG_CONFIG_HOME
        })

        afterEach(() => {
          if (originalXdgConfigHome === undefined) {
            delete process.env.XDG_CONFIG_HOME
          } else {
            process.env.XDG_CONFIG_HOME = originalXdgConfigHome
          }
        })

        it('should use XDG_CONFIG_HOME when set on Linux', () => {
          const customConfigDir = '/custom/config'
          process.env.XDG_CONFIG_HOME = customConfigDir

          const result = getGlobalConfigDir()

          expect(result).to.equal(join(customConfigDir, 'brv'))
        })

        it('should fallback to ~/.config/brv when XDG_CONFIG_HOME is not set on Linux', () => {
          delete process.env.XDG_CONFIG_HOME

          const expected = join(homedir(), '.config', 'brv')
          const result = getGlobalConfigDir()

          expect(result).to.equal(expected)
        })
      })
    }

    if (currentPlatform === 'win32') {
      describe('Windows APPDATA support', () => {
        let originalAppData: string | undefined

        beforeEach(() => {
          originalAppData = process.env.APPDATA
        })

        afterEach(() => {
          if (originalAppData === undefined) {
            delete process.env.APPDATA
          } else {
            process.env.APPDATA = originalAppData
          }
        })

        it('should use APPDATA when set on Windows', () => {
          const appDataDir = String.raw`C:\Users\Test\AppData\Roaming`
          process.env.APPDATA = appDataDir

          const result = getGlobalConfigDir()

          expect(result).to.equal(join(appDataDir, 'brv'))
        })

        it('should fallback to home/AppData/Roaming/brv when APPDATA is not set', () => {
          delete process.env.APPDATA

          const expected = join(homedir(), 'AppData', 'Roaming', 'brv')
          const result = getGlobalConfigDir()

          expect(result).to.equal(expected)
        })
      })
    }
  })

  describe('getGlobalConfigPath()', () => {
    it('should return a path ending with config.json', () => {
      const result = getGlobalConfigPath()

      expect(result).to.match(/config\.json$/)
    })

    it('should include the brv directory in the path', () => {
      const result = getGlobalConfigPath()

      expect(result).to.include(join('brv', 'config.json'))
    })

    it('should be based on getGlobalConfigDir()', () => {
      const configDir = getGlobalConfigDir()
      const configPath = getGlobalConfigPath()

      expect(configPath).to.equal(join(configDir, 'config.json'))
    })
  })
})
