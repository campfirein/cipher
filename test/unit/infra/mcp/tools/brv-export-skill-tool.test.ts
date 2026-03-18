import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {expect} from 'chai'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {registerBrvExportSkillTool} from '../../../../../src/server/infra/mcp/tools/brv-export-skill-tool.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportToolHandler = (input: {cwd?: string}) => Promise<{
  content: Array<{text: string; type: string}>
  isError?: boolean
}>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noWorkingDirectory = (): string | undefined => undefined

function createMockMcpServer(): {
  getHandler: (name: string) => ExportToolHandler
  server: McpServer
} {
  const handlers = new Map<string, ExportToolHandler>()

  const mock = {
    registerTool(name: string, _config: unknown, cb: ExportToolHandler) {
      handlers.set(name, cb)
    },
  }

  return {
    getHandler(name: string): ExportToolHandler {
      const handler = handlers.get(name)
      if (!handler) throw new Error(`Handler ${name} not registered`)

      return handler
    },
    server: mock as unknown as McpServer,
  }
}

/**
 * Create a temporary .brv project with optional experience files.
 */
function createTempProject(options?: {
  experienceBullets?: {deadEnds?: string[]; hints?: string[]; lessons?: string[]; strategies?: string[]}
}): {cleanup: () => void; projectRoot: string} {
  const projectRoot = mkdtempSync(join(tmpdir(), 'brv-export-test-'))
  const brvDir = join(projectRoot, '.brv')
  const ctDir = join(brvDir, 'context-tree')
  const expDir = join(ctDir, 'experience')

  mkdirSync(expDir, {recursive: true})
  writeFileSync(join(brvDir, 'config.json'), JSON.stringify({version: '0.0.1'}))

  const now = new Date().toISOString()
  const frontmatter = [
    '---',
    'title: "Experience"',
    'tags: []',
    'keywords: []',
    'importance: 70',
    'recency: 1',
    'maturity: validated',
    'accessCount: 0',
    'updateCount: 0',
    `createdAt: "${now}"`,
    `updatedAt: "${now}"`,
    '---',
    '',
  ].join('\n')

  const bullets = options?.experienceBullets
  const lessonBullets = (bullets?.lessons ?? []).map((b) => `- ${b}`).join('\n')
  const hintBullets = (bullets?.hints ?? []).map((b) => `- ${b}`).join('\n')
  const deadEndBullets = (bullets?.deadEnds ?? []).map((b) => `- ${b}`).join('\n')
  const strategyBullets = (bullets?.strategies ?? []).map((b) => `- ${b}`).join('\n')

  writeFileSync(join(expDir, 'lessons.md'), `${frontmatter}## Facts\n${lessonBullets}\n`)
  writeFileSync(join(expDir, 'hints.md'), `${frontmatter}## Hints\n${hintBullets}\n`)
  writeFileSync(join(expDir, 'dead-ends.md'), `${frontmatter}## Dead Ends\n${deadEndBullets}\n`)
  writeFileSync(join(expDir, 'playbook.md'), `${frontmatter}## Strategies\n${strategyBullets}\n`)

  // Curation count
  const curationCount = (bullets?.lessons?.length ?? 0) + (bullets?.hints?.length ?? 0)
  writeFileSync(join(expDir, '_meta.json'), JSON.stringify({curationCount, lastConsolidatedAt: ''}))

  return {
    cleanup() {
      rmSync(projectRoot, {force: true, recursive: true})
    },
    projectRoot,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('brv-export-skill MCP tool', () => {
  let projects: Array<{cleanup: () => void}> = []

  afterEach(() => {
    for (const p of projects) {
      p.cleanup()
    }

    projects = []
  })

  it('returns error when cwd is missing in global mode', async () => {
    const {getHandler, server} = createMockMcpServer()
    registerBrvExportSkillTool(server, noWorkingDirectory)
    const handler = getHandler('brv-export-skill')

    const result = await handler({})

    expect(result.isError).to.equal(true)
    expect(result.content[0].text).to.include('cwd parameter is required')
  })

  it('returns error when no .brv project is found', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'brv-no-project-'))
    projects.push({cleanup: () => rmSync(tempDir, {force: true, recursive: true})})

    const {getHandler, server} = createMockMcpServer()
    registerBrvExportSkillTool(server, noWorkingDirectory)
    const handler = getHandler('brv-export-skill')

    const result = await handler({cwd: tempDir})

    expect(result.isError).to.equal(true)
    expect(result.content[0].text).to.include('No ByteRover project found')
  })

  it('returns empty knowledge message when no experience exists', async () => {
    const project = createTempProject()
    projects.push(project)

    const {getHandler, server} = createMockMcpServer()
    registerBrvExportSkillTool(server, () => project.projectRoot)
    const handler = getHandler('brv-export-skill')

    const result = await handler({})

    expect(result.isError).to.be.undefined
    expect(result.content[0].text).to.include('No project knowledge accumulated yet')
  })

  it('returns rendered knowledge text when experience exists', async () => {
    const project = createTempProject({
      experienceBullets: {
        deadEnds: ['dont use localStorage'],
        lessons: ['auth uses JWT', 'tokens in httpOnly cookies'],
      },
    })
    projects.push(project)

    const {getHandler, server} = createMockMcpServer()
    registerBrvExportSkillTool(server, () => project.projectRoot)
    const handler = getHandler('brv-export-skill')

    const result = await handler({})

    expect(result.isError).to.be.undefined
    const [{text}] = result.content
    expect(text).to.include('## Project Knowledge (Auto-Updated)')
    expect(text).to.include('- auth uses JWT')
    expect(text).to.include('- tokens in httpOnly cookies')
    expect(text).to.include('- dont use localStorage')
  })

  it('includes sync summary or "no connectors" in response', async () => {
    const project = createTempProject({
      experienceBullets: {lessons: ['some lesson']},
    })
    projects.push(project)

    const {getHandler, server} = createMockMcpServer()
    registerBrvExportSkillTool(server, () => project.projectRoot)
    const handler = getHandler('brv-export-skill')

    const result = await handler({})

    // Response always includes knowledge text
    const [{text}] = result.content
    expect(text).to.include('- some lesson')
    // Response must mention either sync targets or "no connectors" — never silent
    const hasSyncSummary = text.includes('Synced to') || text.includes('No skill connectors installed')
    expect(hasSyncSummary).to.equal(true)
  })

  it('walks up from subdirectory to find project root', async () => {
    const project = createTempProject({
      experienceBullets: {lessons: ['found from subdir']},
    })
    projects.push(project)

    const subDir = join(project.projectRoot, 'src', 'deep')
    mkdirSync(subDir, {recursive: true})

    const {getHandler, server} = createMockMcpServer()
    registerBrvExportSkillTool(server, noWorkingDirectory)
    const handler = getHandler('brv-export-skill')

    const result = await handler({cwd: subDir})

    expect(result.isError).to.be.undefined
    expect(result.content[0].text).to.include('- found from subdir')
  })
})
