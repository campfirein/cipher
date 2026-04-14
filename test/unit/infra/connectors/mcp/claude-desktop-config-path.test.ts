import {expect} from 'chai'
import {join} from 'node:path'

import {getClaudeDesktopConfigPath} from '../../../../../src/server/infra/connectors/mcp/claude-desktop-config-path.js'

const CONFIG_FILE = 'claude_desktop_config.json'
const MSIX_PACKAGE_DIR = 'Claude_pzs8sxrjxfjjc'

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

    it('should return MSIX path when MSIX directory exists and LOCALAPPDATA is set', () => {
      const localAppData = String.raw`C:\Users\Test\AppData\Local`
      const msixDir = join(localAppData, 'Packages', MSIX_PACKAGE_DIR, 'LocalCache', 'Roaming', 'Claude')

      const result = getClaudeDesktopConfigPath({
        env: {APPDATA: String.raw`C:\Users\Test\AppData\Roaming`, LOCALAPPDATA: localAppData},
        existsSync: (path: string) => path === msixDir,
        homedir: () => String.raw`C:\Users\Test`,
        platform: () => 'win32',
      })

      expect(result).to.equal(join(msixDir, CONFIG_FILE))
    })

    it('should return MSIX path using homedir fallback when LOCALAPPDATA is not set', () => {
      const homedir = String.raw`C:\Users\Test`
      const msixDir = join(homedir, 'AppData', 'Local', 'Packages', MSIX_PACKAGE_DIR, 'LocalCache', 'Roaming', 'Claude')

      const result = getClaudeDesktopConfigPath({
        env: {APPDATA: String.raw`C:\Users\Test\AppData\Roaming`},
        existsSync: (path: string) => path === msixDir,
        homedir: () => homedir,
        platform: () => 'win32',
      })

      expect(result).to.equal(join(msixDir, CONFIG_FILE))
    })

    it('should return standard path when MSIX directory does not exist', () => {
      const result = getClaudeDesktopConfigPath({
        env: {APPDATA: String.raw`C:\Users\Test\AppData\Roaming`, LOCALAPPDATA: String.raw`C:\Users\Test\AppData\Local`},
        existsSync: () => false,
        homedir: () => String.raw`C:\Users\Test`,
        platform: () => 'win32',
      })

      expect(result).to.equal(join(String.raw`C:\Users\Test\AppData\Roaming`, 'Claude', CONFIG_FILE))
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
