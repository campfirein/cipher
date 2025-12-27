import {expect} from 'chai'
import {homedir, platform} from 'node:os'
import {join, sep} from 'node:path'

import {getGlobalLogsDir} from '../../../src/utils/global-logs-path.js'

describe('global-logs-path', () => {
  describe('getGlobalLogsDir()', () => {
    const currentPlatform = platform()

    it('should return an absolute path', () => {
      const result = getGlobalLogsDir()

      // On all platforms, the path should start with root
      expect(result).to.satisfy(
        (p: string) =>
          // Windows: starts with drive letter (C:\)
          // Unix: starts with /
          p.startsWith(sep) || /^[A-Za-z]:/.test(p),
      )
    })

    it('should end with brv directory (logs parent)', () => {
      const result = getGlobalLogsDir()

      // macOS: ~/Library/Logs/brv (ends with brv)
      // Linux/Windows: .../brv/logs (ends with logs)
      expect(result).to.satisfy((p: string) => p.endsWith('brv') || p.endsWith('logs'))
    })

    it('should include brv in the path', () => {
      const result = getGlobalLogsDir()

      expect(result).to.include('brv')
    })

    if (currentPlatform === 'darwin') {
      it('should return ~/Library/Logs/brv on macOS', () => {
        const expected = join(homedir(), 'Library', 'Logs', 'brv')
        const result = getGlobalLogsDir()

        expect(result).to.equal(expected)
      })
    }

    if (currentPlatform === 'linux') {
      describe('XDG_STATE_HOME support', () => {
        let originalXdgStateHome: string | undefined

        beforeEach(() => {
          originalXdgStateHome = process.env.XDG_STATE_HOME
        })

        afterEach(() => {
          if (originalXdgStateHome === undefined) {
            delete process.env.XDG_STATE_HOME
          } else {
            process.env.XDG_STATE_HOME = originalXdgStateHome
          }
        })

        it('should use XDG_STATE_HOME when set on Linux', () => {
          const customStateDir = '/custom/state'
          process.env.XDG_STATE_HOME = customStateDir

          const result = getGlobalLogsDir()

          expect(result).to.equal(join(customStateDir, 'brv', 'logs'))
        })

        it('should fallback to ~/.local/state/brv/logs when XDG_STATE_HOME is not set on Linux', () => {
          delete process.env.XDG_STATE_HOME

          const expected = join(homedir(), '.local', 'state', 'brv', 'logs')
          const result = getGlobalLogsDir()

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

          const result = getGlobalLogsDir()

          expect(result).to.equal(join(localAppDataDir, 'brv', 'logs'))
        })

        it('should fallback to home/AppData/Local/brv/logs when LOCALAPPDATA is not set', () => {
          delete process.env.LOCALAPPDATA

          const expected = join(homedir(), 'AppData', 'Local', 'brv', 'logs')
          const result = getGlobalLogsDir()

          expect(result).to.equal(expected)
        })
      })
    }

    describe('fallback behavior', () => {
      it('should never throw an error', () => {
        // This test ensures the function always returns a valid path
        // even in edge cases
        expect(() => getGlobalLogsDir()).to.not.throw()
      })

      it('should always return a valid brv logs path', () => {
        const result = getGlobalLogsDir()

        // The result should always include 'brv' in the path
        expect(result).to.include('brv')

        // The path should be absolute
        expect(result).to.satisfy((p: string) => p.startsWith(sep) || /^[A-Za-z]:/.test(p))
      })
    })
  })
})
