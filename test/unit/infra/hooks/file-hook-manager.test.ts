import {expect} from 'chai'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

import {type HookSupportedAgent} from '../../../../src/core/interfaces/hooks/i-hook-manager.js'
import {FsFileService} from '../../../../src/infra/file/fs-file-service.js'
import {HOOK_COMMAND} from '../../../../src/infra/hooks/agent-hook-configs.js'
import {FileHookManager} from '../../../../src/infra/hooks/file-hook-manager.js'

describe('FileHookManager', () => {
  let testDir: string
  let fileService: FsFileService
  let hookManager: FileHookManager

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `brv-hook-test-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
    fileService = new FsFileService()
    hookManager = new FileHookManager(fileService, testDir)
  })

  afterEach(async () => {
    await rm(testDir, {force: true, recursive: true})
  })

  describe('getSupportedAgents', () => {
    it('should return all supported agents', () => {
      const agents = hookManager.getSupportedAgents()
      expect(agents).to.include('Claude Code')
      expect(agents).to.include('Cursor')
      expect(agents).to.have.lengthOf(2)
    })
  })

  describe('Claude Code', () => {
    const agent: HookSupportedAgent = 'Claude Code'
    const configPath = '.claude/settings.local.json'

    describe('install', () => {
      it('should create new config file if not exists', async () => {
        const result = await hookManager.install(agent)

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

        const result = await hookManager.install(agent)

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

        const result = await hookManager.install(agent)

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

        const result = await hookManager.install(agent)

        expect(result.success).to.be.true
        expect(result.alreadyInstalled).to.be.true
      })
    })

    describe('uninstall', () => {
      it('should return wasInstalled false if config not exists', async () => {
        const result = await hookManager.uninstall(agent)

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

        const result = await hookManager.uninstall(agent)

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

        const result = await hookManager.uninstall(agent)

        expect(result.success).to.be.true
        expect(result.wasInstalled).to.be.false
      })
    })

    describe('status', () => {
      it('should return configExists false if file not exists', async () => {
        const result = await hookManager.status(agent)

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

        const result = await hookManager.status(agent)

        expect(result.configExists).to.be.true
        expect(result.installed).to.be.true
        expect(result.error).to.be.undefined
      })

      it('should return installed false if hook not present', async () => {
        const existingConfig = {hooks: {UserPromptSubmit: []}}
        await mkdir(path.join(testDir, '.claude'), {recursive: true})
        await writeFile(path.join(testDir, configPath), JSON.stringify(existingConfig))

        const result = await hookManager.status(agent)

        expect(result.configExists).to.be.true
        expect(result.installed).to.be.false
        expect(result.error).to.be.undefined
      })
    })
  })

  describe('Cursor', () => {
    const agent: HookSupportedAgent = 'Cursor'
    const configPath = '.cursor/hooks.json'

    describe('install', () => {
      it('should create new config with version field', async () => {
        const result = await hookManager.install(agent)

        expect(result.success).to.be.true

        const content = await fileService.read(path.join(testDir, configPath))
        const json = JSON.parse(content)
        expect(json.version).to.equal(1)
        expect(json.hooks.beforeSubmitPrompt).to.have.lengthOf(1)
        expect(json.hooks.beforeSubmitPrompt[0].command).to.equal(HOOK_COMMAND)
      })

      it('should preserve other hooks', async () => {
        const existingConfig = {
          hooks: {
            beforeShellCommand: [{command: 'shell-hook'}],
            beforeSubmitPrompt: [{command: 'other-hook'}],
          },
          version: 1,
        }
        await mkdir(path.join(testDir, '.cursor'), {recursive: true})
        await writeFile(path.join(testDir, configPath), JSON.stringify(existingConfig))

        const result = await hookManager.install(agent)

        expect(result.success).to.be.true

        const content = await fileService.read(path.join(testDir, configPath))
        const json = JSON.parse(content)
        expect(json.hooks.beforeSubmitPrompt).to.have.lengthOf(2)
        expect(json.hooks.beforeShellCommand).to.have.lengthOf(1) // preserved
      })
    })

    describe('uninstall', () => {
      it('should remove only our hook', async () => {
        const existingConfig = {
          hooks: {
            beforeSubmitPrompt: [{command: 'other-hook'}, {command: HOOK_COMMAND}],
          },
          version: 1,
        }
        await mkdir(path.join(testDir, '.cursor'), {recursive: true})
        await writeFile(path.join(testDir, configPath), JSON.stringify(existingConfig))

        const result = await hookManager.uninstall(agent)

        expect(result.success).to.be.true
        expect(result.wasInstalled).to.be.true

        const content = await fileService.read(path.join(testDir, configPath))
        const json = JSON.parse(content)
        expect(json.hooks.beforeSubmitPrompt).to.have.lengthOf(1)
        expect(json.hooks.beforeSubmitPrompt[0].command).to.equal('other-hook')
      })
    })
  })

  describe('edge cases', () => {
    it('should handle malformed JSON gracefully on install', async () => {
      await mkdir(path.join(testDir, '.claude'), {recursive: true})
      await writeFile(path.join(testDir, '.claude/settings.local.json'), 'not valid json')

      const result = await hookManager.install('Claude Code')

      expect(result.success).to.be.false
      expect(result.message).to.include('Failed to install')
    })

    it('should handle malformed JSON gracefully on status and report error', async () => {
      await mkdir(path.join(testDir, '.claude'), {recursive: true})
      await writeFile(path.join(testDir, '.claude/settings.local.json'), 'not valid json')

      const result = await hookManager.status('Claude Code')

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
      await writeFile(
        path.join(testDir, '.claude/settings.local.json'),
        JSON.stringify(existingConfig),
      )

      const result = await hookManager.uninstall('Claude Code')

      expect(result.success).to.be.true
      expect(result.wasInstalled).to.be.true

      const content = await fileService.read(path.join(testDir, '.claude/settings.local.json'))
      const json = JSON.parse(content)
      expect(json.hooks.UserPromptSubmit).to.have.lengthOf(0) // both removed
    })
  })
})
