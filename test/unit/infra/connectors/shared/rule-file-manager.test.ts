import {expect} from 'chai'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

import {BRV_RULE_MARKERS, BRV_RULE_TAG} from '../../../../../src/infra/connectors/shared/constants.js'
import {RuleFileManager} from '../../../../../src/infra/connectors/shared/rule-file-manager.js'
import {FsFileService} from '../../../../../src/infra/file/fs-file-service.js'

describe('RuleFileManager', () => {
  let testDir: string
  let fileService: FsFileService
  let ruleFileManager: RuleFileManager

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `rule-file-manager-test-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
    fileService = new FsFileService()
    ruleFileManager = new RuleFileManager({
      fileService,
      projectRoot: testDir,
    })
  })

  afterEach(async () => {
    await rm(testDir, {force: true, recursive: true})
  })

  describe('status', () => {
    it('should return fileExists=false when file does not exist', async () => {
      const result = await ruleFileManager.status('non-existent.md')

      expect(result.fileExists).to.equal(false)
      expect(result.hasMarkers).to.equal(false)
      expect(result.hasLegacyTag).to.equal(false)
    })

    it('should return hasMarkers=false when file exists but has no markers', async () => {
      const filePath = 'rules.md'
      await writeFile(path.join(testDir, filePath), 'Some content without markers')

      const result = await ruleFileManager.status(filePath)

      expect(result.fileExists).to.equal(true)
      expect(result.hasMarkers).to.equal(false)
      expect(result.hasLegacyTag).to.equal(false)
    })

    it('should return hasMarkers=true when file has BRV markers', async () => {
      const filePath = 'rules.md'
      const content = `Some content\n${BRV_RULE_MARKERS.START}\nBRV content\n${BRV_RULE_MARKERS.END}\nMore content`
      await writeFile(path.join(testDir, filePath), content)

      const result = await ruleFileManager.status(filePath)

      expect(result.fileExists).to.equal(true)
      expect(result.hasMarkers).to.equal(true)
    })

    it('should return hasLegacyTag=true when file has legacy tag without markers', async () => {
      const filePath = 'rules.md'
      const content = `Some content\n${BRV_RULE_TAG} Claude Code\nMore content`
      await writeFile(path.join(testDir, filePath), content)

      const result = await ruleFileManager.status(filePath)

      expect(result.fileExists).to.equal(true)
      expect(result.hasMarkers).to.equal(false)
      expect(result.hasLegacyTag).to.equal(true)
    })

    it('should return both hasMarkers and hasLegacyTag when both present', async () => {
      const filePath = 'rules.md'
      const content = `${BRV_RULE_MARKERS.START}\n${BRV_RULE_TAG} Claude Code\n${BRV_RULE_MARKERS.END}`
      await writeFile(path.join(testDir, filePath), content)

      const result = await ruleFileManager.status(filePath)

      expect(result.fileExists).to.equal(true)
      expect(result.hasMarkers).to.equal(true)
      expect(result.hasLegacyTag).to.equal(true)
    })
  })

  describe('install', () => {
    const ruleContent = `${BRV_RULE_MARKERS.START}\nBRV rule content\n${BRV_RULE_MARKERS.END}`

    describe('with overwrite mode', () => {
      it('should create new file if not exists', async () => {
        const filePath = 'rules.md'

        const result = await ruleFileManager.install(filePath, 'overwrite', ruleContent)

        expect(result.success).to.equal(true)
        expect(result.isNew).to.equal(true)

        const content = await fileService.read(path.join(testDir, filePath))
        expect(content).to.equal(ruleContent)
      })

      it('should overwrite existing file completely', async () => {
        const filePath = 'rules.md'
        await writeFile(path.join(testDir, filePath), 'Old content that should be replaced')

        const result = await ruleFileManager.install(filePath, 'overwrite', ruleContent)

        expect(result.success).to.equal(true)
        expect(result.isNew).to.equal(true)

        const content = await fileService.read(path.join(testDir, filePath))
        expect(content).to.equal(ruleContent)
      })

      it('should replace existing markers section', async () => {
        const filePath = 'rules.md'
        const oldContent = `${BRV_RULE_MARKERS.START}\nOld BRV content\n${BRV_RULE_MARKERS.END}`
        await writeFile(path.join(testDir, filePath), oldContent)

        const result = await ruleFileManager.install(filePath, 'overwrite', ruleContent)

        expect(result.success).to.equal(true)
        expect(result.isNew).to.equal(false)

        const content = await fileService.read(path.join(testDir, filePath))
        expect(content).to.equal(ruleContent)
      })
    })

    describe('with append mode', () => {
      it('should create new file if not exists', async () => {
        const filePath = 'rules.md'

        const result = await ruleFileManager.install(filePath, 'append', ruleContent)

        expect(result.success).to.equal(true)
        expect(result.isNew).to.equal(true)

        const content = await fileService.read(path.join(testDir, filePath))
        expect(content).to.equal(ruleContent)
      })

      it('should append to existing file without markers', async () => {
        const filePath = 'rules.md'
        const existingContent = 'Existing user content'
        await writeFile(path.join(testDir, filePath), existingContent)

        const result = await ruleFileManager.install(filePath, 'append', ruleContent)

        expect(result.success).to.equal(true)
        expect(result.isNew).to.equal(true)

        const content = await fileService.read(path.join(testDir, filePath))
        expect(content).to.include(existingContent)
        expect(content).to.include(ruleContent)
      })

      it('should replace existing markers section preserving other content', async () => {
        const filePath = 'rules.md'
        const userContent = 'User content before\n'
        const oldMarkerContent = `${BRV_RULE_MARKERS.START}\nOld BRV content\n${BRV_RULE_MARKERS.END}`
        const userContentAfter = '\nUser content after'
        await writeFile(path.join(testDir, filePath), userContent + oldMarkerContent + userContentAfter)

        const result = await ruleFileManager.install(filePath, 'append', ruleContent)

        expect(result.success).to.equal(true)
        expect(result.isNew).to.equal(false)

        const content = await fileService.read(path.join(testDir, filePath))
        expect(content).to.include('User content before')
        expect(content).to.include('User content after')
        expect(content).to.include('BRV rule content')
        expect(content).not.to.include('Old BRV content')
      })
    })

    it('should create nested directories if needed', async () => {
      const filePath = 'nested/dir/rules.md'

      const result = await ruleFileManager.install(filePath, 'overwrite', ruleContent)

      expect(result.success).to.equal(true)
      expect(result.isNew).to.equal(true)

      const content = await fileService.read(path.join(testDir, filePath))
      expect(content).to.equal(ruleContent)
    })
  })

  describe('uninstall', () => {
    const ruleContent = `${BRV_RULE_MARKERS.START}\nBRV rule content\n${BRV_RULE_MARKERS.END}`

    describe('with overwrite mode', () => {
      it('should return wasInstalled=false when file does not exist', async () => {
        const result = await ruleFileManager.uninstall('non-existent.md', 'overwrite')

        expect(result.success).to.equal(true)
        expect(result.wasInstalled).to.equal(false)
      })

      it('should return wasInstalled=false when file has no markers', async () => {
        const filePath = 'rules.md'
        await writeFile(path.join(testDir, filePath), 'Content without markers')

        const result = await ruleFileManager.uninstall(filePath, 'overwrite')

        expect(result.success).to.equal(true)
        expect(result.wasInstalled).to.equal(false)
      })

      it('should delete file when markers exist', async () => {
        const filePath = 'rules.md'
        await writeFile(path.join(testDir, filePath), ruleContent)

        const result = await ruleFileManager.uninstall(filePath, 'overwrite')

        expect(result.success).to.equal(true)
        expect(result.wasInstalled).to.equal(true)

        const exists = await fileService.exists(path.join(testDir, filePath))
        expect(exists).to.equal(false)
      })
    })

    describe('with append mode', () => {
      it('should return wasInstalled=false when file does not exist', async () => {
        const result = await ruleFileManager.uninstall('non-existent.md', 'append')

        expect(result.success).to.equal(true)
        expect(result.wasInstalled).to.equal(false)
      })

      it('should return wasInstalled=false when file has no markers', async () => {
        const filePath = 'rules.md'
        await writeFile(path.join(testDir, filePath), 'Content without markers')

        const result = await ruleFileManager.uninstall(filePath, 'append')

        expect(result.success).to.equal(true)
        expect(result.wasInstalled).to.equal(false)
      })

      it('should remove only marker section and preserve other content', async () => {
        const filePath = 'rules.md'
        const userContent = 'User content before\n'
        const userContentAfter = '\nUser content after'
        await writeFile(path.join(testDir, filePath), userContent + ruleContent + userContentAfter)

        const result = await ruleFileManager.uninstall(filePath, 'append')

        expect(result.success).to.equal(true)
        expect(result.wasInstalled).to.equal(true)

        const content = await fileService.read(path.join(testDir, filePath))
        expect(content).to.include('User content before')
        expect(content).to.include('User content after')
        expect(content).not.to.include('BRV rule content')
        expect(content).not.to.include(BRV_RULE_MARKERS.START)
        expect(content).not.to.include(BRV_RULE_MARKERS.END)
      })

      it('should delete file if only marker section remains', async () => {
        const filePath = 'rules.md'
        await writeFile(path.join(testDir, filePath), ruleContent)

        const result = await ruleFileManager.uninstall(filePath, 'append')

        expect(result.success).to.equal(true)
        expect(result.wasInstalled).to.equal(true)

        const exists = await fileService.exists(path.join(testDir, filePath))
        expect(exists).to.equal(false)
      })
    })
  })

  describe('removeMarkerSection', () => {
    it('should return content unchanged if no markers present', () => {
      const content = 'Some content without markers'

      const result = ruleFileManager.removeMarkerSection(content)

      expect(result).to.equal(content)
    })

    it('should return content unchanged if only start marker present', () => {
      const content = `Some content\n${BRV_RULE_MARKERS.START}\nMore content`

      const result = ruleFileManager.removeMarkerSection(content)

      expect(result).to.equal(content)
    })

    it('should return content unchanged if only end marker present', () => {
      const content = `Some content\n${BRV_RULE_MARKERS.END}\nMore content`

      const result = ruleFileManager.removeMarkerSection(content)

      expect(result).to.equal(content)
    })

    it('should remove marker section and content between markers', () => {
      const content = `Before\n${BRV_RULE_MARKERS.START}\nBRV content\n${BRV_RULE_MARKERS.END}\nAfter`

      const result = ruleFileManager.removeMarkerSection(content)

      expect(result).to.include('Before')
      expect(result).to.include('After')
      expect(result).not.to.include('BRV content')
      expect(result).not.to.include(BRV_RULE_MARKERS.START)
      expect(result).not.to.include(BRV_RULE_MARKERS.END)
    })

    it('should clean up extra newlines after removal', () => {
      const content = `Before\n\n\n${BRV_RULE_MARKERS.START}\nBRV content\n${BRV_RULE_MARKERS.END}\n\n\nAfter`

      const result = ruleFileManager.removeMarkerSection(content)

      expect(result).not.to.include('\n\n\n')
    })
  })

  describe('replaceMarkerSection', () => {
    it('should return content unchanged if no markers present', () => {
      const content = 'Some content without markers'
      const newContent = 'New BRV content'

      const result = ruleFileManager.replaceMarkerSection(content, newContent)

      expect(result).to.equal(content)
    })

    it('should replace content between markers', () => {
      const content = `Before\n${BRV_RULE_MARKERS.START}\nOld BRV content\n${BRV_RULE_MARKERS.END}\nAfter`
      const newContent = `${BRV_RULE_MARKERS.START}\nNew BRV content\n${BRV_RULE_MARKERS.END}`

      const result = ruleFileManager.replaceMarkerSection(content, newContent)

      expect(result).to.include('Before')
      expect(result).to.include('After')
      expect(result).to.include('New BRV content')
      expect(result).not.to.include('Old BRV content')
    })

    it('should preserve content before and after markers', () => {
      const content = `User rules\n\n${BRV_RULE_MARKERS.START}\nOld\n${BRV_RULE_MARKERS.END}\n\nMore user rules`
      const newContent = `${BRV_RULE_MARKERS.START}\nNew\n${BRV_RULE_MARKERS.END}`

      const result = ruleFileManager.replaceMarkerSection(content, newContent)

      expect(result).to.include('User rules')
      expect(result).to.include('More user rules')
    })
  })
})
