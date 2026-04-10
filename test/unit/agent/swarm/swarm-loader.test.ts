/// <reference types="mocha" />

import {expect} from 'chai'
import path from 'node:path'

import type {SwarmFileReader} from '../../../../src/agent/infra/swarm/types.js'

import {SwarmValidationError} from '../../../../src/agent/infra/swarm/errors.js'
import {SwarmLoader} from '../../../../src/agent/infra/swarm/swarm-loader.js'

// ─── In-memory file reader stub ───

function createStubReader(files: Record<string, string>): SwarmFileReader {
  const normalized = new Map<string, string>()
  for (const [k, v] of Object.entries(files)) {
    normalized.set(path.resolve(k), v)
  }

  return {
    async exists(p: string) {
      const resolved = path.resolve(p)
      return normalized.has(resolved) || [...normalized.keys()].some((k) => k.startsWith(resolved + '/'))
    },
    async glob(dir: string, pattern: string) {
      const resolvedDir = path.resolve(dir)
      const suffix = pattern.replace('**/', '')
      return [...normalized.keys()].filter((k) => k.startsWith(resolvedDir + '/') && k.endsWith(suffix))
    },
    async isDirectory(p: string) {
      const resolved = path.resolve(p)
      return !normalized.has(resolved) && [...normalized.keys()].some((k) => k.startsWith(resolved + '/'))
    },
    async readFile(p: string) {
      const resolved = path.resolve(p)
      const content = normalized.get(resolved)
      if (content === undefined) throw new Error(`ENOENT: ${resolved}`)

      return content
    },
  }
}

// ─── Valid fixture content ───

const VALID_SWARM_MD = `---
name: Test Swarm
description: A test swarm
slug: test-swarm
schema: byterover-swarm/v1
version: 1.0.0
goals:
  - Test goal
includes:
  - agents/analyzer/AGENT.md
  - agents/synthesizer/AGENT.md
---

Test swarm description.
`

const ANALYZER_AGENT_MD = `---
name: Analyzer
slug: analyzer
description: Code analyzer
role: worker
skills:
  - review
---

Analyze the code.
`

const SYNTHESIZER_AGENT_MD = `---
name: Synthesizer
slug: synthesizer
description: Synthesis agent
role: worker
---

Synthesize findings.
`

const VALID_SWARM_YAML = `schema: byterover-swarm/v1

agents:
  analyzer:
    adapter:
      type: claude_code
    timeoutSec: 120

  synthesizer:
    adapter:
      type: process
      config:
        command: echo
    output: true
    timeoutSec: 60

edges:
  - from: analyzer
    to: synthesizer

potential_edges:
  - from: synthesizer
    to: analyzer
`

function validFiles(root = '/swarm'): Record<string, string> {
  return {
    [`${root}/.swarm.yaml`]: VALID_SWARM_YAML,
    [`${root}/agents/analyzer/AGENT.md`]: ANALYZER_AGENT_MD,
    [`${root}/agents/synthesizer/AGENT.md`]: SYNTHESIZER_AGENT_MD,
    [`${root}/SWARM.md`]: VALID_SWARM_MD,
  }
}

describe('SwarmLoader', () => {
  describe('happy path', () => {
    it('should load a valid swarm spec', async () => {
      const reader = createStubReader(validFiles())
      const loader = new SwarmLoader({fileReader: reader})

      const loaded = await loader.load('/swarm')

      expect(loaded.frontmatter.name).to.equal('Test Swarm')
      expect(loaded.frontmatter.slug).to.equal('test-swarm')
      expect(loaded.description).to.include('Test swarm description.')
      expect(loaded.agents).to.have.lengthOf(2)
      expect(loaded.agents[0].frontmatter.slug).to.equal('analyzer')
      expect(loaded.agents[0].prompt).to.include('Analyze the code.')
      expect(loaded.agents[1].frontmatter.slug).to.equal('synthesizer')
      expect(loaded.runtimeConfig.edges).to.have.lengthOf(1)
      expect(loaded.runtimeConfig.potentialEdges).to.have.lengthOf(1)
      expect(loaded.sourceDir).to.equal(path.resolve('/swarm'))
    })

    it('should resolve sourceDir to absolute path', async () => {
      const reader = createStubReader(validFiles())
      const loader = new SwarmLoader({fileReader: reader})

      const loaded = await loader.load('/swarm')

      expect(path.isAbsolute(loaded.sourceDir)).to.be.true
    })

    it('should produce warning when no output nodes defined', async () => {
      const files = validFiles()
      files['/swarm/.swarm.yaml'] = VALID_SWARM_YAML.replace('output: true\n    ', '')
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      const loaded = await loader.load('/swarm')

      expect(loaded.warnings).to.have.lengthOf(1)
      expect(loaded.warnings[0]).to.include('output')
    })
  })

  describe('missing files', () => {
    it('should throw when directory does not exist', async () => {
      const reader = createStubReader({})
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/nonexistent')
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('does not exist')
      }
    })

    it('should throw when path is not a directory', async () => {
      const reader = createStubReader({'/afile': 'content'})
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/afile')
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('not a directory')
      }
    })

    it('should throw when SWARM.md is missing', async () => {
      const files = validFiles()
      delete files['/swarm/SWARM.md']
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('SWARM.md')
      }
    })

    it('should throw when .swarm.yaml is missing', async () => {
      const files = validFiles()
      delete files['/swarm/.swarm.yaml']
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('.swarm.yaml')
      }
    })

    it('should throw SwarmValidationError when included AGENT.md is missing', async () => {
      const files = validFiles()
      delete files['/swarm/agents/synthesizer/AGENT.md']
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(SwarmValidationError)
        const ve = error as SwarmValidationError
        expect(ve.errors.some((e) => e.includes('agents/synthesizer/AGENT.md'))).to.be.true
      }
    })
  })

  describe('schema validation', () => {
    it('should throw when SWARM.md schema is wrong', async () => {
      const files = validFiles()
      files['/swarm/SWARM.md'] = VALID_SWARM_MD.replace('byterover-swarm/v1', 'wrong/v1')
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('schema')
      }
    })

    it('should throw when SWARM.md missing required name', async () => {
      const files = validFiles()
      files['/swarm/SWARM.md'] = VALID_SWARM_MD.replace('name: Test Swarm\n', '')
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('name')
      }
    })

    it('should throw SwarmValidationError when AGENT.md missing required slug', async () => {
      const files = validFiles()
      files['/swarm/agents/analyzer/AGENT.md'] = ANALYZER_AGENT_MD.replace('slug: analyzer\n', '')
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(SwarmValidationError)
        const ve = error as SwarmValidationError
        expect(ve.errors.some((e) => e.includes('slug'))).to.be.true
      }
    })

    it('should throw on invalid adapter type in .swarm.yaml', async () => {
      const files = validFiles()
      files['/swarm/.swarm.yaml'] = VALID_SWARM_YAML.replace('type: claude_code', 'type: unknown_type')
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('unknown_type')
      }
    })
  })

  describe('includes validation', () => {
    it('should throw on duplicate includes', async () => {
      const files = validFiles()
      files['/swarm/SWARM.md'] = VALID_SWARM_MD.replace(
        'includes:\n  - agents/analyzer/AGENT.md\n  - agents/synthesizer/AGENT.md',
        'includes:\n  - agents/analyzer/AGENT.md\n  - agents/analyzer/AGENT.md',
      )
      // Also update .swarm.yaml to only have analyzer
      files['/swarm/.swarm.yaml'] = VALID_SWARM_YAML.replace(
        /\n {2}synthesizer:[\s\S]*?(?=\nedges:)/,
        '',
      ).replace(
        /potential_edges:[\s\S]*$/,
        'potential_edges: []\n',
      )
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('uplicate')
      }
    })

    it('should throw on duplicate includes after normalization', async () => {
      const files = validFiles()
      files['/swarm/SWARM.md'] = VALID_SWARM_MD.replace(
        'includes:\n  - agents/analyzer/AGENT.md\n  - agents/synthesizer/AGENT.md',
        'includes:\n  - agents/analyzer/AGENT.md\n  - ./agents/../agents/analyzer/AGENT.md',
      )
      files['/swarm/.swarm.yaml'] = VALID_SWARM_YAML.replace(
        /\n {2}synthesizer:[\s\S]*?(?=\nedges:)/,
        '',
      ).replace(
        /potential_edges:[\s\S]*$/,
        'potential_edges: []\n',
      )
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('uplicate')
      }
    })

    it('should throw on path traversal', async () => {
      const files = validFiles()
      files['/swarm/SWARM.md'] = VALID_SWARM_MD.replace(
        'agents/synthesizer/AGENT.md',
        '../../etc/passwd',
      )
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('escapes')
      }
    })
  })

  describe('slug/config consistency', () => {
    it('should throw SwarmValidationError on duplicate agent slugs', async () => {
      const files = validFiles()
      files['/swarm/agents/synthesizer/AGENT.md'] = SYNTHESIZER_AGENT_MD.replace(
        'slug: synthesizer',
        'slug: analyzer',
      )
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(SwarmValidationError)
        const ve = error as SwarmValidationError
        expect(ve.errors.some((e) => e.includes('uplicate') && e.includes('analyzer'))).to.be.true
      }
    })

    it('should throw SwarmValidationError when .swarm.yaml references unknown agent slug', async () => {
      const files = validFiles()
      files['/swarm/.swarm.yaml'] = VALID_SWARM_YAML.replace('analyzer:', 'unknown-agent:')
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(SwarmValidationError)
        const ve = error as SwarmValidationError
        expect(ve.errors.some((e) => e.includes('unknown-agent'))).to.be.true
      }
    })

    it('should throw SwarmValidationError when AGENT.md slug has no config in .swarm.yaml', async () => {
      const files = validFiles()
      files['/swarm/.swarm.yaml'] = VALID_SWARM_YAML.replace(
        /\n {2}synthesizer:[\s\S]*?(?=\nedges:)/,
        '',
      )
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(SwarmValidationError)
        const ve = error as SwarmValidationError
        expect(ve.errors.some((e) => e.includes('synthesizer') && e.includes('no entry'))).to.be.true
      }
    })
  })

  describe('edge validation', () => {
    it('should throw SwarmValidationError when edge references unknown agent slug', async () => {
      const files = validFiles()
      files['/swarm/.swarm.yaml'] = VALID_SWARM_YAML.replace('from: analyzer', 'from: ghost')
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(SwarmValidationError)
        const ve = error as SwarmValidationError
        expect(ve.errors.some((e) => e.includes('ghost'))).to.be.true
      }
    })

    it('should throw SwarmValidationError on duplicate fixed edges', async () => {
      const files = validFiles()
      files['/swarm/.swarm.yaml'] = VALID_SWARM_YAML.replace(
        'edges:\n  - from: analyzer\n    to: synthesizer',
        'edges:\n  - from: analyzer\n    to: synthesizer\n  - from: analyzer\n    to: synthesizer',
      )
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(SwarmValidationError)
        const ve = error as SwarmValidationError
        expect(ve.errors.some((e) => e.includes('uplicate'))).to.be.true
      }
    })

    it('should throw SwarmValidationError on duplicate potential edges', async () => {
      const files = validFiles()
      files['/swarm/.swarm.yaml'] = VALID_SWARM_YAML.replace(
        'potential_edges:\n  - from: synthesizer\n    to: analyzer',
        'potential_edges:\n  - from: synthesizer\n    to: analyzer\n  - from: synthesizer\n    to: analyzer',
      )
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(SwarmValidationError)
        const ve = error as SwarmValidationError
        expect(ve.errors.some((e) => e.includes('uplicate'))).to.be.true
      }
    })

    it('should throw SwarmValidationError when same edge in both fixed and potential', async () => {
      const files = validFiles()
      files['/swarm/.swarm.yaml'] = VALID_SWARM_YAML.replace(
        'potential_edges:\n  - from: synthesizer\n    to: analyzer',
        'potential_edges:\n  - from: analyzer\n    to: synthesizer',
      )
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(SwarmValidationError)
        const ve = error as SwarmValidationError
        expect(ve.errors.some((e) => e.includes('both'))).to.be.true
      }
    })
  })

  describe('error accumulation', () => {
    it('should collect multiple slug mismatches in one throw', async () => {
      const files = validFiles()
      // Config has "unknown1" and "unknown2" instead of real slugs
      files['/swarm/.swarm.yaml'] = VALID_SWARM_YAML
        .replace('analyzer:', 'unknown1:')
        .replace('synthesizer:', 'unknown2:')
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(SwarmValidationError)
        const ve = error as SwarmValidationError
        expect(ve.errors.some((e) => e.includes('unknown1'))).to.be.true
        expect(ve.errors.some((e) => e.includes('unknown2'))).to.be.true
        expect(ve.errors.some((e) => e.includes('analyzer') && e.includes('no entry'))).to.be.true
        expect(ve.errors.some((e) => e.includes('synthesizer') && e.includes('no entry'))).to.be.true
      }
    })

    it('should include cascade note when includes fail and cross-validation errors exist', async () => {
      const files = validFiles()
      // Remove one agent file so it fails to load
      delete files['/swarm/agents/synthesizer/AGENT.md']
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(SwarmValidationError)
        const ve = error as SwarmValidationError
        expect(ve.note).to.include('1 included file(s) failed to load')
        // The actual file error + cross-validation errors should both be present
        expect(ve.errors.length).to.be.greaterThan(1)
      }
    })

    it('should not include cascade note when errors are only from cross-validation (no failed includes)', async () => {
      // Config references unknown slug, but all includes load fine → no cascade note
      const files = validFiles()
      files['/swarm/.swarm.yaml'] = VALID_SWARM_YAML.replace('analyzer:', 'unknown-agent:')
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(SwarmValidationError)
        const ve = error as SwarmValidationError
        expect(ve.errors.length).to.be.greaterThan(0)
        expect(ve.note).to.be.null
      }
    })

    it('should still fail-fast on missing SWARM.md (plain Error)', async () => {
      const files = validFiles()
      delete files['/swarm/SWARM.md']
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      try {
        await loader.load('/swarm')
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.not.be.instanceOf(SwarmValidationError)
        expect((error as Error).message).to.include('SWARM.md')
      }
    })
  })

  describe('file discovery warnings', () => {
    it('should warn about orphan AGENT.md not in includes', async () => {
      const files = validFiles()
      // Add an orphan agent file not referenced by SWARM.md includes
      files['/swarm/agents/researcher/AGENT.md'] = `---
name: Researcher
slug: researcher
description: Research agent
role: worker
---

Research things.
`
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      const loaded = await loader.load('/swarm')

      expect(loaded.warnings.some((w) => w.includes('researcher/AGENT.md') && w.includes('not in SWARM.md includes'))).to.be.true
    })

    it('should not warn when all AGENT.md files are in includes', async () => {
      const files = validFiles()
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      const loaded = await loader.load('/swarm')

      expect(loaded.warnings.filter((w) => w.includes('not in SWARM.md includes'))).to.have.lengthOf(0)
    })

    it('should warn about multiple orphan AGENT.md files', async () => {
      const files = validFiles()
      files['/swarm/agents/researcher/AGENT.md'] = `---
name: Researcher
slug: researcher
description: Research
role: worker
---
Research.
`
      files['/swarm/agents/tester/AGENT.md'] = `---
name: Tester
slug: tester
description: Test
role: worker
---
Test.
`
      const reader = createStubReader(files)
      const loader = new SwarmLoader({fileReader: reader})

      const loaded = await loader.load('/swarm')

      const discoveryWarnings = loaded.warnings.filter((w) => w.includes('not in SWARM.md includes'))
      expect(discoveryWarnings).to.have.lengthOf(2)
    })
  })
})
