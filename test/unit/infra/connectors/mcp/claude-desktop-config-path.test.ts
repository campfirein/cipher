import {expect} from 'chai'
import {join} from 'node:path'

import {getClaudeDesktopConfigPath} from '../../../../../src/server/infra/connectors/mcp/claude-desktop-config-path.js'

const CONFIG_FILE = 'claude_desktop_config.json'

describe('getClaudeDesktopConfigPath', () => {
  describe('macOS (darwin)', () => {
    it('should return ~/Library/Application Support/Claude path', () => {
      const result = getClaudeDesktopConfigPath({
        homedir: () => '/Users/testuser',
        platform: () => 'darwin',
      })

      expect(result).to.equal(join('/Users/testuser', 'Library', 'Application Support', 'Claude', CONFIG_FILE))
    })
  })

  describe('Windows (win32)', () => {
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

    it('should use APPDATA when set', () => {
      process.env.APPDATA = String.raw`C:\Users\Test\AppData\Roaming`

      const result = getClaudeDesktopConfigPath({
        homedir: () => String.raw`C:\Users\Test`,
        platform: () => 'win32',
      })

      expect(result).to.equal(join(String.raw`C:\Users\Test\AppData\Roaming`, 'Claude', CONFIG_FILE))
    })

    it('should fall back to ~/AppData/Roaming when APPDATA is not set', () => {
      delete process.env.APPDATA

      const result = getClaudeDesktopConfigPath({
        homedir: () => String.raw`C:\Users\Test`,
        platform: () => 'win32',
      })

      expect(result).to.equal(join(String.raw`C:\Users\Test`, 'AppData', 'Roaming', 'Claude', CONFIG_FILE))
    })
  })

  describe('Linux', () => {
    let originalXdg: string | undefined

    beforeEach(() => {
      originalXdg = process.env.XDG_CONFIG_HOME
    })

    afterEach(() => {
      if (originalXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = originalXdg
      }
    })

    it('should return ~/.config/Claude path by default', () => {
      delete process.env.XDG_CONFIG_HOME

      const result = getClaudeDesktopConfigPath({
        homedir: () => '/home/testuser',
        platform: () => 'linux',
      })

      expect(result).to.equal(join('/home/testuser', '.config', 'Claude', CONFIG_FILE))
    })

    it('should use XDG_CONFIG_HOME when set', () => {
      process.env.XDG_CONFIG_HOME = '/custom/config'

      const result = getClaudeDesktopConfigPath({
        homedir: () => '/home/testuser',
        platform: () => 'linux',
      })

      expect(result).to.equal(join('/custom/config', 'Claude', CONFIG_FILE))
    })
  })
})
