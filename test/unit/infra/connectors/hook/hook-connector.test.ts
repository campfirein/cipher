import {expect} from 'chai'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

import {HOOK_COMMAND, type HookSupportedAgent} from '../../../../../src/infra/connectors/hook/hook-connector-config.js'
import {HookConnector} from '../../../../../src/infra/connectors/hook/hook-connector.js'
import {FsFileService} from '../../../../../src/infra/file/fs-file-service.js'

describe('HookConnector', () => {
  let testDir: string
  let fileService: FsFileService
  let hookConnector: HookConnector

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `brv-hook-test-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
    fileService = new FsFileService()
    hookConnector = new HookConnector({
      fileService,
      projectRoot: testDir,
    })
  })

  afterEach(async () => {
    await rm(testDir, {force: true, recursive: true})
  })

  describe('connectorType', () => {
    it('should have type "hook"', () => {
      expect(hookConnector.connectorType).to.equal('hook')
    })
  })

  describe('getSupportedAgents', () => {
    it('should return only Claude Code as supported agent', () => {
      const agents = hookConnector.getSupportedAgents()
      expect(agents).to.deep.equal(['Claude Code'])
      expect(agents).to.have.lengthOf(1)
    })
  })

  describe('isSupported', () => {
    it('should return true for Claude Code', () => {
      expect(hookConnector.isSupported('Claude Code')).to.be.true
    })

    it('should return false for Cursor', () => {
      expect(hookConnector.isSupported('Cursor')).to.be.false
    })

    it('should return false for Github Copilot', () => {
      expect(hookConnector.isSupported('Github Copilot')).to.be.false
    })
  })

  describe('getConfigPath', () => {
    it('should return config path for Claude Code', () => {
      expect(hookConnector.getConfigPath('Claude Code')).to.equal('.claude/settings.local.json')
    })

    it('should throw for unsupported agent', () => {
      expect(() => hookConnector.getConfigPath('Cursor')).to.throw('Hook connector does not support agent: Cursor')
    })
  })

  describe('Claude Code', () => {
    const agent: HookSupportedAgent = 'Claude Code'
    const configPath = '.claude/settings.local.json'

    describe('install', () => {
      it('should create new config file if not exists', async () => {
        const result = await hookConnector.install(agent)

        expect(result.success).to.be.true
        expect(result.alreadyInstalled).to.be.false
        expect(result.configPath).to.equal(configPath)

        const content = await fileService.read(path.join(testDir, configPath))
        const json = JSON.parse(content)
        expect(json.hooks.UserPromptSubmit).to.have.lengthOf(1)
        expect(json.hooks.UserPromptSubmit[0].hooks[0].command).to.equal(HOOK_COMMAND)
      })

      it('should add hook to existing config without other hooks', async () => {
        const existingConfig = {someOtherSetting: true}
        await mkdir(path.join(testDir, '.claude'), {recursive: true})
        await writeFile(path.join(testDir, configPath), JSON.stringify(existingConfig))

        const result = await hookConnector.install(agent)

        expect(result.success).to.be.true
        expect(result.alreadyInstalled).to.be.false

        const content = await fileService.read(path.join(testDir, configPath))
        const json = JSON.parse(content)
        expect(json.someOtherSetting).to.be.true // preserved
        expect(json.hooks.UserPromptSubmit).to.have.lengthOf(1)
      })

      it('should preserve other hooks when installing', async () => {
        const existingConfig = {
          hooks: {
            UserPromptSubmit: [{hooks: [{command: 'other-hook', type: 'command'}], matcher: 'test'}],
          },
        }
        await mkdir(path.join(testDir, '.claude'), {recursive: true})
        await writeFile(path.join(testDir, configPath), JSON.stringify(existingConfig))

        const result = await hookConnector.install(agent)

        expect(result.success).to.be.true
        expect(result.alreadyInstalled).to.be.false

        const content = await fileService.read(path.join(testDir, configPath))
        const json = JSON.parse(content)
        expect(json.hooks.UserPromptSubmit).to.have.lengthOf(2)
        expect(json.hooks.UserPromptSubmit[0].hooks[0].command).to.equal('other-hook')
        expect(json.hooks.UserPromptSubmit[1].hooks[0].command).to.equal(HOOK_COMMAND)
      })

      it('should return alreadyInstalled if hook exists', async () => {
        const existingConfig = {
          hooks: {
            UserPromptSubmit: [{hooks: [{command: HOOK_COMMAND, type: 'command'}], matcher: ''}],
          },
        }
        await mkdir(path.join(testDir, '.claude'), {recursive: true})
        await writeFile(path.join(testDir, configPath), JSON.stringify(existingConfig))

        const result = await hookConnector.install(agent)

        expect(result.success).to.be.true
        expect(result.alreadyInstalled).to.be.true
      })

      it('should return failure for unsupported agent', async () => {
        const result = await hookConnector.install('Cursor')

        expect(result.success).to.be.false
        expect(result.message).to.include('does not support agent')
      })
    })

    describe('uninstall', () => {
      it('should return wasInstalled false if config not exists', async () => {
        const result = await hookConnector.uninstall(agent)

        expect(result.success).to.be.true
        expect(result.wasInstalled).to.be.false
      })

      it('should remove only our hook and preserve others', async () => {
        const existingConfig = {
          hooks: {
            UserPromptSubmit: [
              {hooks: [{command: 'other-hook', type: 'command'}], matcher: 'test'},
              {hooks: [{command: HOOK_COMMAND, type: 'command'}], matcher: ''},
            ],
          },
          otherSetting: 'preserved',
        }
        await mkdir(path.join(testDir, '.claude'), {recursive: true})
        await writeFile(path.join(testDir, configPath), JSON.stringify(existingConfig))

        const result = await hookConnector.uninstall(agent)

        expect(result.success).to.be.true
        expect(result.wasInstalled).to.be.true

        const content = await fileService.read(path.join(testDir, configPath))
        const json = JSON.parse(content)
        expect(json.hooks.UserPromptSubmit).to.have.lengthOf(1)
        expect(json.hooks.UserPromptSubmit[0].hooks[0].command).to.equal('other-hook')
        expect(json.otherSetting).to.equal('preserved')
      })

      it('should return wasInstalled false if hook not present', async () => {
        const existingConfig = {
          hooks: {
            UserPromptSubmit: [{hooks: [{command: 'other-hook', type: 'command'}], matcher: 'test'}],
          },
        }
        await mkdir(path.join(testDir, '.claude'), {recursive: true})
        await writeFile(path.join(testDir, configPath), JSON.stringify(existingConfig))

        const result = await hookConnector.uninstall(agent)

        expect(result.success).to.be.true
        expect(result.wasInstalled).to.be.false
      })

      it('should return failure for unsupported agent', async () => {
        const result = await hookConnector.uninstall('Cursor')

        expect(result.success).to.be.false
        expect(result.message).to.include('does not support agent')
      })
    })

    describe('status', () => {
      it('should return configExists false if file not exists', async () => {
        const result = await hookConnector.status(agent)

        expect(result.configExists).to.be.false
        expect(result.installed).to.be.false
        expect(result.error).to.be.undefined
      })

      it('should return installed true if hook exists', async () => {
        const existingConfig = {
          hooks: {
            UserPromptSubmit: [{hooks: [{command: HOOK_COMMAND, type: 'command'}], matcher: ''}],
          },
        }
        await mkdir(path.join(testDir, '.claude'), {recursive: true})
        await writeFile(path.join(testDir, configPath), JSON.stringify(existingConfig))

        const result = await hookConnector.status(agent)

        expect(result.configExists).to.be.true
        expect(result.installed).to.be.true
        expect(result.error).to.be.undefined
      })

      it('should return installed false if hook not present', async () => {
        const existingConfig = {hooks: {UserPromptSubmit: []}}
        await mkdir(path.join(testDir, '.claude'), {recursive: true})
        await writeFile(path.join(testDir, configPath), JSON.stringify(existingConfig))

        const result = await hookConnector.status(agent)

        expect(result.configExists).to.be.true
        expect(result.installed).to.be.false
        expect(result.error).to.be.undefined
      })

      it('should return error status for unsupported agent', async () => {
        const result = await hookConnector.status('Cursor')

        expect(result.configExists).to.be.false
        expect(result.installed).to.be.false
        expect(result.error).to.include('does not support agent')
      })
    })
  })

  describe('edge cases', () => {
    it('should handle malformed JSON gracefully on install', async () => {
      await mkdir(path.join(testDir, '.claude'), {recursive: true})
      await writeFile(path.join(testDir, '.claude/settings.local.json'), 'not valid json')

      const result = await hookConnector.install('Claude Code')

      expect(result.success).to.be.false
      expect(result.message).to.include('Failed to install')
    })

    it('should handle malformed JSON gracefully on status and report error', async () => {
      await mkdir(path.join(testDir, '.claude'), {recursive: true})
      await writeFile(path.join(testDir, '.claude/settings.local.json'), 'not valid json')

      const result = await hookConnector.status('Claude Code')

      expect(result.configExists).to.be.true
      expect(result.installed).to.be.false // can't determine, assume not installed
      expect(result.error).to.be.a('string')
      expect(result.error).to.include('Unexpected token')
    })

    it('should remove duplicate hooks on uninstall', async () => {
      const existingConfig = {
        hooks: {
          UserPromptSubmit: [
            {hooks: [{command: HOOK_COMMAND, type: 'command'}], matcher: ''},
            {hooks: [{command: HOOK_COMMAND, type: 'command'}], matcher: ''}, // duplicate
          ],
        },
      }
      await mkdir(path.join(testDir, '.claude'), {recursive: true})
      await writeFile(path.join(testDir, '.claude/settings.local.json'), JSON.stringify(existingConfig))

      const result = await hookConnector.uninstall('Claude Code')

      expect(result.success).to.be.true
      expect(result.wasInstalled).to.be.true

      const content = await fileService.read(path.join(testDir, '.claude/settings.local.json'))
      const json = JSON.parse(content)
      expect(json.hooks.UserPromptSubmit).to.have.lengthOf(0) // both removed
    })
  })
})
