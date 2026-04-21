import {expect} from 'chai'
import {existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'

import {CONTEXT_TREE_GITIGNORE_HEADER, CONTEXT_TREE_GITIGNORE_PATTERNS} from '../../../src/server/constants.js'
import {ensureContextTreeGitignore, ensureGitignoreEntries} from '../../../src/server/utils/gitignore.js'

const FULL_GITIGNORE = CONTEXT_TREE_GITIGNORE_HEADER + '\n' + CONTEXT_TREE_GITIGNORE_PATTERNS.join('\n') + '\n'

describe('gitignore utils', () => {
  let testDir: string

  beforeEach(() => {
    const rawTestDir = path.join(tmpdir(), `gitignore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(rawTestDir, {recursive: true})
    testDir = realpathSync(rawTestDir)
  })

  afterEach(() => {
    try {
      rmSync(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('ensureGitignoreEntries', () => {
    it('should add entries to a new .gitignore in a git repo', async () => {
      mkdirSync(path.join(testDir, '.git'))

      await ensureGitignoreEntries(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.include('# ByteRover')
      expect(content).to.include('.brv/')
    })

    it('should append to an existing .gitignore preserving original content', async () => {
      mkdirSync(path.join(testDir, '.git'))
      writeFileSync(path.join(testDir, '.gitignore'), 'node_modules/\ndist/\n')

      await ensureGitignoreEntries(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.include('node_modules/')
      expect(content).to.include('dist/')
      expect(content).to.include('# ByteRover')
      expect(content).to.include('.brv/')
    })

    it('should be idempotent — no duplicates on re-run', async () => {
      mkdirSync(path.join(testDir, '.git'))

      await ensureGitignoreEntries(testDir)
      await ensureGitignoreEntries(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      const matches = content.match(/^\.brv\/$/gm)
      expect(matches).to.have.lengthOf(1)
    })

    it('should not create .gitignore in a non-git directory', async () => {
      await ensureGitignoreEntries(testDir)

      expect(existsSync(path.join(testDir, '.gitignore'))).to.be.false
    })

    it('should add a trailing newline before entries if existing file lacks one', async () => {
      mkdirSync(path.join(testDir, '.git'))
      writeFileSync(path.join(testDir, '.gitignore'), 'node_modules/')

      await ensureGitignoreEntries(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.include('node_modules/\n\n# ByteRover')
    })

    it('should handle an empty existing .gitignore', async () => {
      mkdirSync(path.join(testDir, '.git'))
      writeFileSync(path.join(testDir, '.gitignore'), '')

      await ensureGitignoreEntries(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.include('# ByteRover')
      expect(content).to.include('.brv/')
    })
  })

  describe('ensureContextTreeGitignore', () => {
    it('should create .gitignore with full content when file does not exist', async () => {
      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.equal(FULL_GITIGNORE)
    })

    it('should create .gitignore with full content when file is empty', async () => {
      writeFileSync(path.join(testDir, '.gitignore'), '')

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.equal(FULL_GITIGNORE)
    })

    it('should not modify file when all patterns are already present', async () => {
      writeFileSync(path.join(testDir, '.gitignore'), FULL_GITIGNORE)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.equal(FULL_GITIGNORE)
    })

    it('should append only missing patterns', async () => {
      const partial = `# Derived artifacts — do not track
.gitignore
.snapshot.json
_manifest.json
_index.md
`
      writeFileSync(path.join(testDir, '.gitignore'), partial)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.include('*.abstract.md')
      expect(content).to.include('*.overview.md')
      const abstractMatches = content.match(/^\*\.abstract\.md$/gm)
      expect(abstractMatches).to.have.lengthOf(1)
    })

    it('should not re-add pattern when user has negation', async () => {
      const withNegation = `# Derived artifacts — do not track
.gitignore
.snapshot.json
_manifest.json
_index.md
!*.abstract.md
*.overview.md
`
      writeFileSync(path.join(testDir, '.gitignore'), withNegation)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.not.match(/^\*\.abstract\.md$/m)
      expect(content).to.include('!*.abstract.md')
    })

    it('should not re-add pattern when user commented it out with space', async () => {
      const withComment = `# Derived artifacts — do not track
.gitignore
.snapshot.json
# _manifest.json
_index.md
*.abstract.md
*.overview.md
`
      writeFileSync(path.join(testDir, '.gitignore'), withComment)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      const manifestMatches = content.match(/^_manifest\.json$/gm)
      expect(manifestMatches).to.be.null
    })

    it('should not re-add pattern when user commented it out without space', async () => {
      const withComment = `# Derived artifacts — do not track
.gitignore
.snapshot.json
#_manifest.json
_index.md
*.abstract.md
*.overview.md
`
      writeFileSync(path.join(testDir, '.gitignore'), withComment)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      const manifestMatches = content.match(/^_manifest\.json$/gm)
      expect(manifestMatches).to.be.null
    })

    it('should preserve existing user content when appending', async () => {
      const userContent = `# My custom rules
my-local-file.txt
temp/
`
      writeFileSync(path.join(testDir, '.gitignore'), userContent)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.include('# My custom rules')
      expect(content).to.include('my-local-file.txt')
      expect(content).to.include('temp/')
      expect(content).to.include('.gitignore')
      expect(content).to.include('*.abstract.md')
    })

    it('should be idempotent — no duplicates on re-run', async () => {
      await ensureContextTreeGitignore(testDir)
      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      const matches = content.match(/^_manifest\.json$/gm)
      expect(matches).to.have.lengthOf(1)
    })

    it('should add proper separator when file lacks trailing newline', async () => {
      const noTrailing = '.gitignore\n.snapshot.json'
      writeFileSync(path.join(testDir, '.gitignore'), noTrailing)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.not.include('.snapshot.json_')
      expect(content).to.include('.snapshot.json\n')
      expect(content).to.include('_manifest.json')
    })

    it('should upgrade from pre-ENG-2014 version — append only new patterns', async () => {
      const oldVersion = `# Derived artifacts — do not track
.gitignore
.snapshot.json
_manifest.json
_index.md
`
      writeFileSync(path.join(testDir, '.gitignore'), oldVersion)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.include('*.abstract.md')
      expect(content).to.include('*.overview.md')
      expect(content.match(/^\.gitignore$/gm)).to.have.lengthOf(1)
      expect(content.match(/^\.snapshot\.json$/gm)).to.have.lengthOf(1)
      expect(content.match(/^_manifest\.json$/gm)).to.have.lengthOf(1)
      expect(content.match(/^_index\.md$/gm)).to.have.lengthOf(1)
      expect(content.match(/^# Derived/gm)).to.have.lengthOf(1)
    })

    it('should upgrade from old version with user customizations', async () => {
      const oldCustomized = `# Derived artifacts — do not track
.gitignore
.snapshot.json
_manifest.json
_index.md

# My project rules
build/
temp-notes.md
`
      writeFileSync(path.join(testDir, '.gitignore'), oldCustomized)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.include('*.abstract.md')
      expect(content).to.include('*.overview.md')
      expect(content).to.include('# My project rules')
      expect(content).to.include('build/')
      expect(content).to.include('temp-notes.md')
    })

    it('should add all patterns when file is entirely custom with no brv content', async () => {
      const custom = `# My own rules
build/
logs/
`
      writeFileSync(path.join(testDir, '.gitignore'), custom)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.include('# My own rules')
      expect(content).to.include('build/')
      expect(content).to.include('logs/')
      expect(content).to.include('# Derived artifacts')
      expect(content).to.include('.gitignore')
      expect(content).to.include('.snapshot.json')
      expect(content).to.include('_manifest.json')
      expect(content).to.include('_index.md')
      expect(content).to.include('*.abstract.md')
      expect(content).to.include('*.overview.md')
    })

    it('should respect negation for pattern with special regex chars', async () => {
      const withSpecialNegation = `# Derived artifacts — do not track
.gitignore
.snapshot.json
_manifest.json
_index.md
!*.abstract.md
!*.overview.md
`
      writeFileSync(path.join(testDir, '.gitignore'), withSpecialNegation)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.not.match(/^\*\.abstract\.md$/m)
      expect(content).to.not.match(/^\*\.overview\.md$/m)
      expect(content).to.include('!*.abstract.md')
      expect(content).to.include('!*.overview.md')
    })

    it('should detect commented-out pattern with special regex chars', async () => {
      const withCommentedGlob = `# Derived artifacts — do not track
.gitignore
.snapshot.json
_manifest.json
_index.md
# *.abstract.md
*.overview.md
`
      writeFileSync(path.join(testDir, '.gitignore'), withCommentedGlob)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content.match(/^\*\.abstract\.md$/gm)).to.be.null
      expect(content).to.include('# *.abstract.md')
    })

    it('should handle mixed negations, comments, and missing patterns', async () => {
      const mixed = `# Derived artifacts — do not track
.gitignore
!.snapshot.json
# _manifest.json
_index.md
`
      writeFileSync(path.join(testDir, '.gitignore'), mixed)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.not.match(/^\.snapshot\.json$/m)
      expect(content).to.include('!.snapshot.json')
      expect(content.match(/^_manifest\.json$/gm)).to.be.null
      expect(content).to.include('*.abstract.md')
      expect(content).to.include('*.overview.md')
    })

    it('should handle lines with leading/trailing whitespace', async () => {
      const withSpaces = FULL_GITIGNORE
        .replace(/^\.gitignore$/m, '  .gitignore')
        .replace(/^\.snapshot\.json$/m, '  .snapshot.json')
        .replace(/^\*\.abstract\.md$/m, '  *.abstract.md')
      writeFileSync(path.join(testDir, '.gitignore'), withSpaces)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.equal(withSpaces)
    })

    it('should skip pattern when a variant already covers it — /_manifest.json contains _manifest.json', async () => {
      const withSlash = FULL_GITIGNORE.replace(/^_manifest\.json$/m, '/_manifest.json')
      writeFileSync(path.join(testDir, '.gitignore'), withSlash)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.equal(withSlash)
    })

    it('should handle file with only header comment and no patterns', async () => {
      const headerOnly = `# Derived artifacts — do not track
`
      writeFileSync(path.join(testDir, '.gitignore'), headerOnly)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.include('.gitignore')
      expect(content).to.include('.snapshot.json')
      expect(content).to.include('_manifest.json')
      expect(content).to.include('_index.md')
      expect(content).to.include('*.abstract.md')
      expect(content).to.include('*.overview.md')
      expect(content.match(/^# Derived/gm)).to.have.lengthOf(1)
    })

    it('should handle file with blank lines between patterns', async () => {
      const withBlanks = `# Derived artifacts — do not track

.gitignore

.snapshot.json

_manifest.json
_index.md
`
      writeFileSync(path.join(testDir, '.gitignore'), withBlanks)

      await ensureContextTreeGitignore(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf8')
      expect(content).to.include('*.abstract.md')
      expect(content).to.include('*.overview.md')
      expect(content.match(/^\.gitignore$/gm)).to.have.lengthOf(1)
    })
  })
})
