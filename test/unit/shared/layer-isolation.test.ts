import {expect} from 'chai'
import {readdirSync, readFileSync, statSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const sharedDir = join(repoRoot, 'src', 'shared')

// Foundation rule: shared/ is the lowest layer, consumed by server, agent, tui,
// webui, and oclif. It must depend ONLY on node_modules and other shared files.
// Any import from a higher layer inverts the dependency direction and creates
// a transitive coupling that defeats the boundary rules ESLint enforces on
// webui/ and tui/.
const FORBIDDEN_LAYERS = ['server', 'agent', 'tui', 'webui', 'oclif']

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      walkTs(path, out)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(path)
    }
  }

  return out
}

describe('shared/ layer isolation', () => {
  it('contains no imports from server/, agent/, tui/, webui/, or oclif/', () => {
    const files = walkTs(sharedDir)
    const violations: string[] = []

    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      for (const layer of FORBIDDEN_LAYERS) {
        const pattern = new RegExp(String.raw`from\s+['"][^'"]*\b${layer}\/`)
        if (pattern.test(content)) {
          violations.push(`${file.slice(repoRoot.length + 1)}: imports from ${layer}/`)
        }
      }
    }

    expect(violations, `\n${violations.join('\n')}\n`).to.deep.equal([])
  })
})
