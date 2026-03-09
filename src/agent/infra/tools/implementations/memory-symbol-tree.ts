import type { FrontmatterScoring } from '../../../../server/core/domain/knowledge/markdown-writer.js'

import { CONTEXT_FILE } from '../../../../server/constants.js'
import { parseRelations } from '../../../../server/core/domain/knowledge/relation-parser.js'

/**
 * Symbol kinds in the memory hierarchy, ordered by depth.
 * Mirrors Serena's SymbolKind pattern for code symbols.
 */
export enum MemorySymbolKind {
  Context = 4,
  Domain = 1,
  Subtopic = 3,
  Summary = 5,
  Topic = 2,
}

const SYMBOL_KIND_LABELS: Record<MemorySymbolKind, string> = {
  [MemorySymbolKind.Context]: 'context',
  [MemorySymbolKind.Domain]: 'domain',
  [MemorySymbolKind.Subtopic]: 'subtopic',
  [MemorySymbolKind.Summary]: 'summary',
  [MemorySymbolKind.Topic]: 'topic',
}

/**
 * Summary metadata attached to folder nodes that have an _index.md file.
 */
export interface SummaryInfo {
  condensationOrder: number
  tokenCount: number
}

/**
 * A node in the memory symbol tree.
 * Represents a domain, topic, subtopic, or individual context entry.
 */
export interface MemorySymbol {
  children: MemorySymbol[]
  kind: MemorySymbolKind
  metadata: SymbolMetadata
  name: string
  parent: MemorySymbol | undefined
  /** Relative path within context-tree, e.g. "auth/jwt-tokens/refresh.md" */
  path: string
  /** Present when this folder has an _index.md summary */
  summaryInfo?: SummaryInfo
}

export interface SymbolMetadata {
  importance: number
  keywords: string[]
  maturity: string
  tags: string[]
}

/**
 * Minimal summary document shape for attaching summary info to folder nodes.
 * Built from _index.md files during search indexing.
 */
export interface SummaryDocLike {
  condensationOrder: number
  /** Path to the _index.md file, e.g. "domain/topic/_index.md" */
  path: string
  tokenCount: number
}

/**
 * The complete memory symbol tree, built from the context-tree filesystem.
 */
export interface MemorySymbolTree {
  /** All top-level domain nodes */
  root: MemorySymbol[]
  /** O(1) lookup: relative path → symbol node */
  symbolMap: Map<string, MemorySymbol>
}

/**
 * Entry returned by getSymbolOverview.
 */
export interface OverviewEntry {
  childCount: number
  /** Present for folder nodes with _index.md summaries */
  condensationOrder?: number
  importance: number
  kind: string
  maturity: string
  name: string
  path: string
  /** Present for folder nodes with _index.md summaries */
  tokenCount?: number
}

/**
 * Bidirectional reference index built from @relation annotations.
 */
export interface ReferenceIndex {
  /** target path → source paths that reference it */
  backlinks: Map<string, string[]>
  /** source path → target paths it references */
  forwardLinks: Map<string, string[]>
}

/**
 * Minimal document shape needed by the tree builder.
 * Matches the IndexedDocument interface in search-knowledge-service.ts.
 */
interface DocumentLike {
  content: string
  id: string
  path: string
  scoring: FrontmatterScoring
  title: string
}

const DEFAULT_METADATA: SymbolMetadata = {
  importance: 50,
  keywords: [],
  maturity: 'draft',
  tags: [],
}

/**
 * Determine the MemorySymbolKind based on path depth and whether it's a context.md file.
 * Path structure: domain/topic/file.md or domain/topic/subtopic/file.md
 */
function determineKind(segments: string[]): MemorySymbolKind {
  switch (segments.length) {
    case 1: {
      return MemorySymbolKind.Domain
    }

    case 2: {
      return MemorySymbolKind.Topic
    }

    case 3: {
      return MemorySymbolKind.Subtopic
    }

    default: {
      // 4+ segments: treat deepest folder as subtopic-level
      return MemorySymbolKind.Subtopic
    }
  }
}

function extractMetadataFromScoring(scoring: FrontmatterScoring): SymbolMetadata {
  return {
    importance: scoring.importance ?? 50,
    keywords: [],
    maturity: scoring.maturity ?? 'draft',
    tags: [],
  }
}

/**
 * Get or create a folder symbol (Domain/Topic/Subtopic) at the given path.
 * Creates intermediate nodes as needed.
 */
function getOrCreateFolderNode(
  symbolMap: Map<string, MemorySymbol>,
  root: MemorySymbol[],
  folderPath: string,
  folderSegments: string[],
): MemorySymbol {
  const existing = symbolMap.get(folderPath)
  if (existing) {
    return existing
  }

  // Ensure parent exists first (recursive)
  let parentNode: MemorySymbol | undefined
  if (folderSegments.length > 1) {
    const parentSegments = folderSegments.slice(0, -1)
    const parentPath = parentSegments.join('/')
    parentNode = getOrCreateFolderNode(symbolMap, root, parentPath, parentSegments)
  }

  const kind = determineKind(folderSegments)
  const node: MemorySymbol = {
    children: [],
    kind,
    metadata: { ...DEFAULT_METADATA },
    name: folderSegments.at(-1)!,
    parent: parentNode,
    path: folderPath,
  }

  symbolMap.set(folderPath, node)

  if (parentNode) {
    parentNode.children.push(node)
  } else {
    // Top-level domain
    root.push(node)
  }

  return node
}

/**
 * Build a symbol tree from the indexed document map.
 * No filesystem I/O — operates entirely on the already-loaded documents.
 *
 * context.md files are absorbed into their parent folder node (enriching its metadata)
 * rather than being treated as leaf Context nodes.
 *
 * @param documentMap - Indexed documents (excludes _index.md, includes stubs)
 * @param summaryMap - Optional map of _index.md summary documents for folder annotation
 */
export function buildSymbolTree(
  documentMap: Map<string, DocumentLike>,
  summaryMap?: Map<string, SummaryDocLike>,
): MemorySymbolTree {
  const root: MemorySymbol[] = []
  const symbolMap = new Map<string, MemorySymbol>()

  // First pass: collect all documents, create folder nodes, identify context.md files
  const contextFiles: DocumentLike[] = []
  const leafDocuments: DocumentLike[] = []

  for (const doc of documentMap.values()) {
    const segments = doc.path.split('/')
    const fileName = segments.at(-1)!

    if (fileName === CONTEXT_FILE) {
      contextFiles.push(doc)
    } else {
      leafDocuments.push(doc)
    }
  }

  // Second pass: create folder nodes for all unique directory paths
  const allFolderPaths = new Set<string>()
  for (const doc of documentMap.values()) {
    const segments = doc.path.split('/')
    // Collect all ancestor folder paths
    for (let i = 1; i < segments.length; i++) {
      allFolderPaths.add(segments.slice(0, i).join('/'))
    }
  }

  for (const folderPath of allFolderPaths) {
    const folderSegments = folderPath.split('/')
    getOrCreateFolderNode(symbolMap, root, folderPath, folderSegments)
  }

  // Third pass: absorb context.md files into their parent folder nodes
  for (const doc of contextFiles) {
    const segments = doc.path.split('/')
    const folderPath = segments.slice(0, -1).join('/')
    const folderNode = symbolMap.get(folderPath)

    if (folderNode) {
      folderNode.metadata = {
        ...folderNode.metadata,
        ...extractMetadataFromScoring(doc.scoring),
      }
    }

    // Also register the context.md path itself for direct lookups
    symbolMap.set(doc.path, folderNode ?? getOrCreateFolderNode(symbolMap, root, folderPath, segments.slice(0, -1)))
  }

  // Fourth pass: create leaf Context nodes for non-context.md documents
  for (const doc of leafDocuments) {
    const segments = doc.path.split('/')
    const folderPath = segments.slice(0, -1).join('/')
    const parentNode = symbolMap.get(folderPath)

    const contextNode: MemorySymbol = {
      children: [],
      kind: MemorySymbolKind.Context,
      metadata: extractMetadataFromScoring(doc.scoring),
      name: doc.title || segments.at(-1)!.replace(/\.md$/, ''),
      parent: parentNode,
      path: doc.path,
    }

    symbolMap.set(doc.path, contextNode)

    if (parentNode) {
      parentNode.children.push(contextNode)
    }
  }

  // Fifth pass: attach summary info from _index.md files to their parent folder nodes
  if (summaryMap) {
    for (const summary of summaryMap.values()) {
      const segments = summary.path.split('/')
      const folderPath = segments.slice(0, -1).join('/')
      const folderNode = symbolMap.get(folderPath)

      if (folderNode) {
        folderNode.summaryInfo = {
          condensationOrder: summary.condensationOrder,
          tokenCount: summary.tokenCount,
        }
      }
    }
  }

  // Sort root domains and all children alphabetically
  sortSymbolChildren(root)

  return { root, symbolMap }
}

function sortSymbolChildren(symbols: MemorySymbol[]): void {
  symbols.sort((a, b) => a.name.localeCompare(b.name))
  for (const symbol of symbols) {
    if (symbol.children.length > 0) {
      sortSymbolChildren(symbol.children)
    }
  }
}

/**
 * Get a structural overview of the symbol tree at configurable depth.
 *
 * @param tree - The memory symbol tree
 * @param path - Optional path to scope the overview (e.g. "auth" for auth domain only)
 * @param depth - Max depth to traverse (default 2: domains + topics)
 */
export function getSymbolOverview(
  tree: MemorySymbolTree,
  path?: string,
  depth: number = 2,
): OverviewEntry[] {
  const entries: OverviewEntry[] = []
  let startNodes: MemorySymbol[]

  if (path) {
    const node = tree.symbolMap.get(path)
    if (!node) {
      return []
    }

    startNodes = [node]
  } else {
    startNodes = tree.root
  }

  function traverse(symbols: MemorySymbol[], currentDepth: number): void {
    for (const symbol of symbols) {
      const entry: OverviewEntry = {
        childCount: symbol.children.length,
        importance: symbol.metadata.importance,
        kind: SYMBOL_KIND_LABELS[symbol.kind] ?? 'unknown',
        maturity: symbol.metadata.maturity,
        name: symbol.name,
        path: symbol.path,
      }

      if (symbol.summaryInfo) {
        entry.condensationOrder = symbol.summaryInfo.condensationOrder
        entry.tokenCount = symbol.summaryInfo.tokenCount
      }

      entries.push(entry)

      if (currentDepth < depth && symbol.children.length > 0) {
        traverse(symbol.children, currentDepth + 1)
      }
    }
  }

  traverse(startNodes, 1)

  return entries
}

/**
 * Collect all leaf document IDs (Context nodes) under a given path.
 * Used for scoped search — restricts MiniSearch to a subtree.
 */
export function getSubtreeDocumentIds(tree: MemorySymbolTree, path: string): Set<string> {
  const ids = new Set<string>()
  const node = tree.symbolMap.get(path)

  if (!node) {
    return ids
  }

  function collect(symbol: MemorySymbol): void {
    if (symbol.kind === MemorySymbolKind.Context) {
      ids.add(symbol.path)
    }

    for (const child of symbol.children) {
      collect(child)
    }
  }

  collect(node)

  return ids
}

/**
 * Build a bidirectional reference index from @relation annotations in document content.
 * Reuses the existing parseRelations() function from relation-parser.ts.
 */
export function buildReferenceIndex(documentMap: Map<string, DocumentLike>): ReferenceIndex {
  const backlinks = new Map<string, string[]>()
  const forwardLinks = new Map<string, string[]>()

  for (const doc of documentMap.values()) {
    const relations = parseRelations(doc.content)

    if (relations.length === 0) {
      continue
    }

    forwardLinks.set(doc.path, relations)

    for (const target of relations) {
      const existing = backlinks.get(target)
      if (existing) {
        existing.push(doc.path)
      } else {
        backlinks.set(target, [doc.path])
      }
    }
  }

  return { backlinks, forwardLinks }
}

/**
 * Get the symbol kind label for display in search results.
 */
export function getSymbolKindLabel(kind: MemorySymbolKind): string {
  return SYMBOL_KIND_LABELS[kind] ?? 'unknown'
}
