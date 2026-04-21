import {expect} from 'chai'

import {isPathLikeQuery, matchMemoryPath, parseSymbolicQuery} from '../../../../src/agent/infra/tools/implementations/memory-path-matcher.js'
import {
  buildReferenceIndex,
  buildSymbolTree,
  getSubtreeDocumentIds,
  getSymbolKindLabel,
  getSymbolOverview,
  MemorySymbolKind,
  type MemorySymbolTree,
} from '../../../../src/agent/infra/tools/implementations/memory-symbol-tree.js'

interface MakeDocOptions {
  content?: string
  importance?: number
  maturity?: string
}

/**
 * Helper to create a minimal IndexedDocument-like object.
 */
function makeDoc(path: string, title: string, options: MakeDocOptions = {}) {
  const {content = '', importance = 50, maturity = 'draft'} = options

  return {
    content,
    id: path,
    mtime: Date.now(),
    path,
    scoring: {importance, maturity: maturity as 'core' | 'draft' | 'validated'},
    title,
  }
}

/**
 * Build a sample document map for testing.
 * Structure:
 *   auth/
 *     context.md
 *     jwt-tokens/
 *       context.md
 *       refresh.md
 *       validation.md
 *     oauth/
 *       overview.md
 *   database/
 *     context.md
 *     connection-pooling/
 *       context.md
 *       tuning.md
 */
function buildSampleDocumentMap() {
  const docs = new Map<string, ReturnType<typeof makeDoc>>()

  docs.set('auth/context.md', makeDoc('auth/context.md', 'Authentication', {content: 'Authentication domain context', importance: 75, maturity: 'validated'}))
  docs.set('auth/jwt-tokens/context.md', makeDoc('auth/jwt-tokens/context.md', 'JWT Tokens', {content: 'JWT topic context', importance: 70, maturity: 'validated'}))
  docs.set('auth/jwt-tokens/refresh.md', makeDoc('auth/jwt-tokens/refresh.md', 'Refresh Token Rotation', {content: 'How refresh tokens work\n\n## Relations\n@database/connection-pooling/tuning.md', importance: 90, maturity: 'core'}))
  docs.set('auth/jwt-tokens/validation.md', makeDoc('auth/jwt-tokens/validation.md', 'Token Validation', {content: 'Validating JWT tokens', importance: 40, maturity: 'draft'}))
  docs.set('auth/oauth/overview.md', makeDoc('auth/oauth/overview.md', 'OAuth Overview', {content: 'OAuth 2.0 flows\n\n## Relations\n@auth/jwt-tokens/refresh.md', importance: 65, maturity: 'validated'}))
  docs.set('database/context.md', makeDoc('database/context.md', 'Database', {content: 'Database domain context', importance: 70, maturity: 'validated'}))
  docs.set('database/connection-pooling/context.md', makeDoc('database/connection-pooling/context.md', 'Connection Pooling', {content: 'Pooling topic context', importance: 50, maturity: 'draft'}))
  docs.set('database/connection-pooling/tuning.md', makeDoc('database/connection-pooling/tuning.md', 'Pool Tuning', {content: 'How to tune connection pool', importance: 60, maturity: 'validated'}))

  return docs
}

describe('Memory Symbol Tree & Path Matcher', () => {
  let tree: MemorySymbolTree

  beforeEach(() => {
    tree = buildSymbolTree(buildSampleDocumentMap())
  })

  describe('buildSymbolTree', () => {
    it('should create top-level domain nodes', () => {
      expect(tree.root).to.have.length(2)
      const names = tree.root.map((n) => n.name)
      expect(names).to.include('auth')
      expect(names).to.include('database')
    })

    it('should assign correct MemorySymbolKind to each level', () => {
      const auth = tree.symbolMap.get('auth')
      const jwtTokens = tree.symbolMap.get('auth/jwt-tokens')
      const oauth = tree.symbolMap.get('auth/oauth')
      const refresh = tree.symbolMap.get('auth/jwt-tokens/refresh.md')

      expect(auth?.kind).to.equal(MemorySymbolKind.Domain)
      expect(jwtTokens?.kind).to.equal(MemorySymbolKind.Topic)
      expect(oauth?.kind).to.equal(MemorySymbolKind.Topic)
      expect(refresh?.kind).to.equal(MemorySymbolKind.Context)
    })

    it('should set parent pointers correctly', () => {
      const refresh = tree.symbolMap.get('auth/jwt-tokens/refresh.md')
      expect(refresh?.parent?.name).to.equal('jwt-tokens')
      expect(refresh?.parent?.parent?.name).to.equal('auth')
      expect(refresh?.parent?.parent?.parent).to.be.undefined
    })

    it('should absorb context.md files into parent folder node (structural only)', () => {
      // Post-commit-5: the symbol tree no longer carries per-node scoring
      // (importance / maturity) — ranking reads those from the sidecar.
      // Metadata collapses to structural defaults at tree-build time.
      const auth = tree.symbolMap.get('auth')
      expect(auth).to.exist
      expect(auth?.metadata.importance).to.equal(50)
      expect(auth?.metadata.maturity).to.equal('draft')
    })

    it('should not create Context nodes for context.md files', () => {
      // context.md should be absorbed, not appear as a leaf
      const allContextNodes = [...tree.symbolMap.values()].filter(
        (s) => s.kind === MemorySymbolKind.Context,
      )
      const contextMdNodes = allContextNodes.filter((s) => s.path.endsWith('context.md'))
      expect(contextMdNodes).to.have.length(0)
    })

    it('should register leaf documents as Context nodes', () => {
      const refresh = tree.symbolMap.get('auth/jwt-tokens/refresh.md')
      expect(refresh).to.exist
      expect(refresh?.kind).to.equal(MemorySymbolKind.Context)
      expect(refresh?.name).to.equal('Refresh Token Rotation')
    })

    it('should populate children arrays', () => {
      const auth = tree.symbolMap.get('auth')
      const childNames = auth?.children.map((c) => c.name)
      expect(childNames).to.include('jwt-tokens')
      expect(childNames).to.include('oauth')
    })

    it('should sort children alphabetically', () => {
      const rootNames = tree.root.map((n) => n.name)
      expect(rootNames).to.deep.equal([...rootNames].sort())
    })

    it('should handle empty document map', () => {
      const emptyTree = buildSymbolTree(new Map())
      expect(emptyTree.root).to.have.length(0)
      expect(emptyTree.symbolMap.size).to.equal(0)
    })
  })

  describe('getSymbolOverview', () => {
    it('should return domains at depth 1', () => {
      const overview = getSymbolOverview(tree, undefined, 1)
      expect(overview).to.have.length(2)
      expect(overview.every((e) => e.kind === 'domain')).to.be.true
    })

    it('should return domains + topics at depth 2 (default)', () => {
      const overview = getSymbolOverview(tree)
      const kinds = new Set(overview.map((e) => e.kind))
      expect(kinds).to.include('domain')
      expect(kinds).to.include('topic')
    })

    it('should include childCount in overview entries', () => {
      const overview = getSymbolOverview(tree, undefined, 1)
      const auth = overview.find((e) => e.name === 'auth')
      // auth has 2 children: jwt-tokens, oauth
      expect(auth?.childCount).to.equal(2)
    })

    it('should scope overview to a specific path', () => {
      const overview = getSymbolOverview(tree, 'auth', 2)
      // Should start from auth, show its children
      expect(overview[0].name).to.equal('auth')
      const childNames = overview.slice(1).map((e) => e.name)
      expect(childNames).to.include('jwt-tokens')
      expect(childNames).to.include('oauth')
    })

    it('should return empty for non-existent path', () => {
      const overview = getSymbolOverview(tree, 'nonexistent')
      expect(overview).to.have.length(0)
    })
  })

  describe('getSubtreeDocumentIds', () => {
    it('should return all leaf document IDs under a domain', () => {
      const ids = getSubtreeDocumentIds(tree, 'auth')
      expect(ids.size).to.equal(3) // refresh.md, validation.md, overview.md
      expect(ids.has('auth/jwt-tokens/refresh.md')).to.be.true
      expect(ids.has('auth/jwt-tokens/validation.md')).to.be.true
      expect(ids.has('auth/oauth/overview.md')).to.be.true
    })

    it('should return leaf documents under a topic', () => {
      const ids = getSubtreeDocumentIds(tree, 'auth/jwt-tokens')
      expect(ids.size).to.equal(2) // refresh.md, validation.md
      expect(ids.has('auth/jwt-tokens/refresh.md')).to.be.true
      expect(ids.has('auth/jwt-tokens/validation.md')).to.be.true
    })

    it('should return empty set for non-existent path', () => {
      const ids = getSubtreeDocumentIds(tree, 'nonexistent')
      expect(ids.size).to.equal(0)
    })

    it('should return single ID for leaf Context node', () => {
      const ids = getSubtreeDocumentIds(tree, 'auth/jwt-tokens/refresh.md')
      expect(ids.size).to.equal(1)
      expect(ids.has('auth/jwt-tokens/refresh.md')).to.be.true
    })
  })

  describe('getSymbolKindLabel', () => {
    it('should return correct labels', () => {
      expect(getSymbolKindLabel(MemorySymbolKind.Domain)).to.equal('domain')
      expect(getSymbolKindLabel(MemorySymbolKind.Topic)).to.equal('topic')
      expect(getSymbolKindLabel(MemorySymbolKind.Subtopic)).to.equal('subtopic')
      expect(getSymbolKindLabel(MemorySymbolKind.Context)).to.equal('context')
    })
  })

  describe('Reference Index', () => {
    it('should build forward and backward links from @relations', () => {
      const docs = buildSampleDocumentMap()
      const refIndex = buildReferenceIndex(docs)

      // refresh.md references database/connection-pooling/tuning.md
      expect(refIndex.forwardLinks.get('auth/jwt-tokens/refresh.md')).to.include(
        'database/connection-pooling/tuning.md',
      )

      // tuning.md has a backlink from refresh.md
      expect(refIndex.backlinks.get('database/connection-pooling/tuning.md')).to.include(
        'auth/jwt-tokens/refresh.md',
      )

      // oauth/overview.md references auth/jwt-tokens/refresh.md
      expect(refIndex.forwardLinks.get('auth/oauth/overview.md')).to.include(
        'auth/jwt-tokens/refresh.md',
      )

      // refresh.md has backlink from overview.md
      expect(refIndex.backlinks.get('auth/jwt-tokens/refresh.md')).to.include(
        'auth/oauth/overview.md',
      )
    })

    it('should handle documents with no relations', () => {
      const docs = new Map()
      docs.set('test.md', makeDoc('test.md', 'Test', {content: 'No relations here'}))
      const refIndex = buildReferenceIndex(docs)

      expect(refIndex.forwardLinks.size).to.equal(0)
      expect(refIndex.backlinks.size).to.equal(0)
    })
  })

  describe('matchMemoryPath', () => {
    it('should match by absolute path (direct lookup)', () => {
      const results = matchMemoryPath(tree, '/auth/jwt-tokens')
      expect(results).to.have.length(1)
      expect(results[0].matchedSymbol.name).to.equal('jwt-tokens')
      expect(results[0].matchType).to.equal('absolute')
    })

    it('should match by relative path (suffix matching)', () => {
      const results = matchMemoryPath(tree, 'auth/jwt-tokens')
      expect(results.length).to.be.greaterThan(0)
      expect(results[0].matchedSymbol.path).to.equal('auth/jwt-tokens')
    })

    it('should match by simple name', () => {
      const results = matchMemoryPath(tree, 'oauth')
      expect(results.length).to.be.greaterThan(0)
      const matchedNames = results.map((r) => r.matchedSymbol.name)
      expect(matchedNames).to.include('oauth')
    })

    it('should support substring matching on last component', () => {
      // "jwt-tokens/refresh" should match "refresh.md" under jwt-tokens via substring
      // because leaf name is "Refresh Token Rotation" which contains "refresh"
      const results = matchMemoryPath(tree, 'jwt-tokens/refresh', {substringMatching: true})
      expect(results.length).to.be.greaterThan(0)
      const paths = results.map((r) => r.matchedSymbol.path)
      expect(paths.some((p) => p.includes('refresh'))).to.be.true
      expect(results.some((r) => r.matchType === 'substring')).to.be.true
    })

    it('should return empty array for no match', () => {
      const results = matchMemoryPath(tree, 'nonexistent/path')
      expect(results).to.have.length(0)
    })

    it('should sort results by specificity', () => {
      // "auth" matches the domain node exactly (simple match)
      const results = matchMemoryPath(tree, 'auth')
      expect(results.length).to.be.greaterThan(0)
      expect(results[0].matchedSymbol.name).to.equal('auth')
    })

    it('should handle empty pattern', () => {
      const results = matchMemoryPath(tree, '')
      expect(results).to.have.length(0)
    })

    it('should match leaf documents by path', () => {
      const results = matchMemoryPath(tree, 'auth/jwt-tokens/refresh.md')
      expect(results.length).to.be.greaterThan(0)
      expect(results[0].matchedSymbol.kind).to.equal(MemorySymbolKind.Context)
    })
  })

  describe('isPathLikeQuery', () => {
    it('should return true for queries with "/"', () => {
      expect(isPathLikeQuery('auth/jwt', tree)).to.be.true
    })

    it('should return true when first word matches a domain name', () => {
      expect(isPathLikeQuery('auth something', tree)).to.be.true
      expect(isPathLikeQuery('database query', tree)).to.be.true
    })

    it('should return false for plain text queries', () => {
      expect(isPathLikeQuery('refresh token rotation', tree)).to.be.false
    })

    it('should return false for empty query', () => {
      expect(isPathLikeQuery('', tree)).to.be.false
    })
  })

  describe('parseSymbolicQuery', () => {
    it('should extract scope from explicit path prefix', () => {
      const parsed = parseSymbolicQuery('auth/jwt-tokens refresh strategy', tree)
      expect(parsed.scopePath).to.equal('auth/jwt-tokens')
      expect(parsed.textQuery).to.equal('refresh strategy')
    })

    it('should extract scope from leading domain word', () => {
      const parsed = parseSymbolicQuery('auth jwt refresh', tree)
      expect(parsed.scopePath).to.exist
      expect(parsed.textQuery).to.be.a('string')
    })

    it('should return undefined scope for plain text query', () => {
      const parsed = parseSymbolicQuery('refresh token rotation', tree)
      expect(parsed.scopePath).to.be.undefined
      expect(parsed.textQuery).to.equal('refresh token rotation')
    })

    it('should handle path-only query (no text part)', () => {
      const parsed = parseSymbolicQuery('auth/jwt-tokens', tree)
      expect(parsed.scopePath).to.equal('auth/jwt-tokens')
      expect(parsed.textQuery).to.equal('')
    })

    it('should return full query as text when path does not match', () => {
      const parsed = parseSymbolicQuery('nonexistent/path some text', tree)
      expect(parsed.scopePath).to.be.undefined
    })
  })
})
