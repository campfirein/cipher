import {expect} from 'chai'
import {join} from 'node:path'

import {getClaudeDesktopConfigPath} from '../../../../../src/server/infra/connectors/mcp/claude-desktop-config-path.js'

const CONFIG_FILE = 'claude_desktop_config.json'

describe('getClaudeDesktopConfigPath', () => {
  describe('macOS (darwin)', () => {
    it('should return ~/Library/Application Support/Claude path', () => {
      const result = getClaudeDesktopConfigPath({
        env: {},
        homedir: () => '/Users/testuser',
        platform: () => 'darwin',
      })

      expect(result).to.equal(join('/Users/testuser', 'Library', 'Application Support', 'Claude', CONFIG_FILE))
    })
  })

  describe('Windows (win32)', () => {
    it('should use APPDATA when set', () => {
      const result = getClaudeDesktopConfigPath({
        env: {APPDATA: String.raw`C:\Users\Test\AppData\Roaming`},
        homedir: () => String.raw`C:\Users\Test`,
        platform: () => 'win32',
      })

      expect(result).to.equal(join(String.raw`C:\Users\Test\AppData\Roaming`, 'Claude', CONFIG_FILE))
    })

    it('should fall back to ~/AppData/Roaming when APPDATA is not set', () => {
      const result = getClaudeDesktopConfigPath({
        env: {},
        homedir: () => String.raw`C:\Users\Test`,
        platform: () => 'win32',
      })

      expect(result).to.equal(join(String.raw`C:\Users\Test`, 'AppData', 'Roaming', 'Claude', CONFIG_FILE))
    })
  })

  describe('Linux', () => {
    it('should return ~/.config/Claude path by default', () => {
      const result = getClaudeDesktopConfigPath({
        env: {},
        homedir: () => '/home/testuser',
        platform: () => 'linux',
      })

      expect(result).to.equal(join('/home/testuser', '.config', 'Claude', CONFIG_FILE))
    })

    it('should use XDG_CONFIG_HOME when set', () => {
      const result = getClaudeDesktopConfigPath({
        env: {XDG_CONFIG_HOME: '/custom/config'},
        homedir: () => '/home/testuser',
        platform: () => 'linux',
      })

      expect(result).to.equal(join('/custom/config', 'Claude', CONFIG_FILE))
    })
  })

  describe('unsupported platform', () => {
    it('should fall back to ~/.config/Claude path', () => {
      const result = getClaudeDesktopConfigPath({
        env: {},
        homedir: () => '/home/testuser',
        platform: () => 'freebsd' as NodeJS.Platform,
      })

      expect(result).to.equal(join('/home/testuser', '.config', 'Claude', CONFIG_FILE))
    })

    it('should respect XDG_CONFIG_HOME on non-linux platforms', () => {
      const result = getClaudeDesktopConfigPath({
        env: {XDG_CONFIG_HOME: '/custom/config'},
        homedir: () => '/home/testuser',
        platform: () => 'freebsd' as NodeJS.Platform,
      })

      expect(result).to.equal(join('/custom/config', 'Claude', CONFIG_FILE))
    })
  })
})
