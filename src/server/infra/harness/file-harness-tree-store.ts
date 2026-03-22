/**
 * File-based persistence for the AutoHarness hypothesis tree.
 *
 * Storage layout (under per-project data dir):
 *   harness/{domain}/_tree.json   — node graph (IDs, parent/child, alpha/beta, heuristic)
 *   harness/{domain}/{nodeId}.md  — template content
 *
 * Follows FileCurateLogStore patterns:
 * - Atomic writes via tmp + rename
 * - Zod schema validation on read
 * - Constructor DI with defaults
 */

import {randomUUID} from 'node:crypto'
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'

import type {HarnessNode, IHarnessTreeStore} from '../../core/interfaces/harness/i-harness-tree-store.js'

// ── Zod schemas ──────────────────────────────────────────────────────────────

const HarnessNodeMetaSchema = z.object({
  alpha: z.number(),
  beta: z.number(),
  childIds: z.array(z.string()),
  createdAt: z.number(),
  heuristic: z.number(),
  id: z.string(),
  metadata: z.record(z.unknown()),
  parentId: z.string().nullable(),
  visitCount: z.number(),
})

const TreeFileSchema = z.object({
  nodes: z.array(HarnessNodeMetaSchema),
  version: z.literal(1),
})

type TreeFile = z.infer<typeof TreeFileSchema>
type NodeMeta = z.infer<typeof HarnessNodeMetaSchema>

// ── Constants ────────────────────────────────────────────────────────────────

const TREE_FILE = '_tree.json'
const HARNESS_DIR = 'harness'

// ── Store implementation ─────────────────────────────────────────────────────

export interface FileHarnessTreeStoreDeps {
  /** Base directory for harness storage (per-project data dir) */
  readonly getBaseDir: () => string
}

export class FileHarnessTreeStore implements IHarnessTreeStore {
  private readonly deps: FileHarnessTreeStoreDeps
  /** Per-domain promise chains to serialize _tree.json read-modify-write cycles */
  private readonly domainWriteLocks = new Map<string, Promise<void>>()

  constructor(deps: FileHarnessTreeStoreDeps) {
    this.deps = deps
  }

  async deleteNode(domain: string, nodeId: string): Promise<void> {
    await this.withDomainWriteLock(domain, async () => {
      const domainDir = this.getDomainDir(domain)
      const tree = await this.readTree(domain)

      tree.nodes = tree.nodes.filter((n) => n.id !== nodeId)

      // Remove from parent's childIds
      for (const node of tree.nodes) {
        node.childIds = node.childIds.filter((id) => id !== nodeId)
      }

      await this.writeTree(domain, tree)

      // Delete template file (best-effort)
      try {
        await rm(join(domainDir, `${nodeId}.md`))
      } catch {
        // File may not exist
      }
    })
  }

  async getAllNodes(domain: string): Promise<HarnessNode[]> {
    const tree = await this.readTree(domain)
    return this.hydrateNodes(domain, tree.nodes)
  }

  async getNode(domain: string, nodeId: string): Promise<HarnessNode | null> {
    const tree = await this.readTree(domain)
    const meta = tree.nodes.find((n) => n.id === nodeId)
    if (!meta) return null

    const nodes = await this.hydrateNodes(domain, [meta])
    return nodes[0] ?? null
  }

  async getRootNode(domain: string): Promise<HarnessNode | null> {
    const tree = await this.readTree(domain)
    const root = tree.nodes.find((n) => n.parentId === null)
    if (!root) return null

    const nodes = await this.hydrateNodes(domain, [root])
    return nodes[0] ?? null
  }

  async saveNode(domain: string, node: HarnessNode): Promise<void> {
    await this.withDomainWriteLock(domain, async () => {
      const domainDir = this.getDomainDir(domain)
      await mkdir(domainDir, {recursive: true})
      const templatePath = join(domainDir, `${node.id}.md`)

      // Update tree metadata
      const tree = await this.readTree(domain)
      const existingIndex = tree.nodes.findIndex((n) => n.id === node.id)
      const meta: NodeMeta = {
        alpha: node.alpha,
        beta: node.beta,
        childIds: node.childIds,
        createdAt: node.createdAt,
        heuristic: node.heuristic,
        id: node.id,
        metadata: node.metadata,
        parentId: node.parentId,
        visitCount: node.visitCount,
      }

      if (existingIndex === -1) {
        tree.nodes.push(meta)
      } else {
        tree.nodes[existingIndex] = meta
      }

      // Write template content first so a node never becomes visible in _tree.json
      // before its template file exists. If the tree write fails, roll back the
      // template write so half-created nodes do not linger on disk.
      const previousTemplate = await this.readTemplateContent(templatePath)
      await this.atomicWrite(templatePath, node.templateContent)

      try {
        await this.writeTree(domain, tree)
      } catch (error) {
        await this.restoreTemplateContent(templatePath, previousTemplate)
        throw error
      }
    })
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tmpPath = `${filePath}.tmp.${randomUUID()}`
    await writeFile(tmpPath, content, 'utf8')
    await rename(tmpPath, filePath)
  }

  private getDomainDir(domain: string): string {
    return join(this.deps.getBaseDir(), HARNESS_DIR, domain)
  }

  private async hydrateNodes(domain: string, metas: NodeMeta[]): Promise<HarnessNode[]> {
    const domainDir = this.getDomainDir(domain)

    const hydrated = await Promise.all(
      metas.map(async (meta) => {
        const templateContent = await this.readTemplateContent(join(domainDir, `${meta.id}.md`))
        if (templateContent === null) {
          return null
        }

        return {...meta, templateContent}
      }),
    )

    return hydrated.filter((node): node is HarnessNode => node !== null)
  }

  private async readTemplateContent(filePath: string): Promise<null | string> {
    try {
      return await readFile(filePath, 'utf8')
    } catch {
      return null
    }
  }

  private async readTree(domain: string): Promise<TreeFile> {
    const treePath = join(this.getDomainDir(domain), TREE_FILE)
    try {
      const raw = await readFile(treePath, 'utf8')
      const parsed = JSON.parse(raw)
      const result = TreeFileSchema.safeParse(parsed)
      if (result.success) return result.data
    } catch {
      // File doesn't exist or is corrupt — return empty tree
    }

    return {nodes: [], version: 1}
  }

  private async restoreTemplateContent(filePath: string, previousContent: null | string): Promise<void> {
    try {
      if (previousContent === null) {
        await rm(filePath, {force: true})
        return
      }

      await this.atomicWrite(filePath, previousContent)
    } catch {
      // Best-effort rollback — leave the original write error as the primary failure.
    }
  }

  private async withDomainWriteLock(domain: string, fn: () => Promise<void>): Promise<void> {
    const previous = this.domainWriteLocks.get(domain) ?? Promise.resolve()
    const current = previous.then(fn, fn)
    this.domainWriteLocks.set(domain, current)

    try {
      await current
    } finally {
      if (this.domainWriteLocks.get(domain) === current) {
        this.domainWriteLocks.delete(domain)
      }
    }
  }

  private async writeTree(domain: string, tree: TreeFile): Promise<void> {
    const domainDir = this.getDomainDir(domain)
    await mkdir(domainDir, {recursive: true})
    const treePath = join(domainDir, TREE_FILE)
    await this.atomicWrite(treePath, JSON.stringify(tree, null, 2))
  }
}
