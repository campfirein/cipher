import type { MemorySymbol, MemorySymbolTree } from './memory-symbol-tree.js'

/**
 * Result of a symbolic path match.
 */
export interface PathMatchResult {
  matchedSymbol: MemorySymbol
  matchType: 'absolute' | 'relative' | 'simple' | 'substring'
}

/**
 * Result of parsing a query into symbolic scope + text components.
 */
export interface ParsedSymbolicQuery {
  /** The resolved scope path (e.g. "auth" or "auth/jwt-tokens"), undefined if no scope found */
  scopePath: string | undefined
  /** The remaining text query after extracting the scope prefix */
  textQuery: string
}

/**
 * Match mode detected from the query pattern.
 */
type MatchMode = 'absolute' | 'relative' | 'simple'

/**
 * Detect the matching mode from a pattern string.
 * - Starts with "/" → absolute (exact path match)
 * - Contains "/" → relative (suffix matching, right-to-left)
 * - No "/" → simple (any symbol with that name)
 */
function detectMatchMode(pattern: string): MatchMode {
  if (pattern.startsWith('/')) {
    return 'absolute'
  }

  if (pattern.includes('/')) {
    return 'relative'
  }

  return 'simple'
}

/**
 * Check if a symbol name matches a component, optionally with substring matching.
 */
function componentMatches(symbolName: string, component: string, substring: boolean): boolean {
  const normalizedSymbol = symbolName.toLowerCase()
  const normalizedComponent = component.toLowerCase()

  if (normalizedSymbol === normalizedComponent) {
    return true
  }

  if (substring && normalizedSymbol.includes(normalizedComponent)) {
    return true
  }

  return false
}

/**
 * Collect all ancestor names for a symbol (from leaf to root), excluding the symbol itself.
 */
function getAncestorNames(symbol: MemorySymbol): string[] {
  const names: string[] = []
  let current = symbol.parent

  while (current) {
    names.push(current.name)
    current = current.parent
  }

  return names
}

/**
 * Match a pattern against a symbol using reversed component iteration.
 * Adapted from Serena's NamePathMatcher — matches from innermost component outward.
 *
 * @param symbol - The symbol to test
 * @param components - Pattern components (already split by "/")
 * @param isAbsolute - Whether the pattern requires an exact full-path match
 * @param substringMatching - Whether the last component supports substring matching
 */
function matchesReversedComponents(
  symbol: MemorySymbol,
  components: string[],
  isAbsolute: boolean,
  substringMatching: boolean,
): boolean {
  // Match from last component backward
  const ancestors = getAncestorNames(symbol)
  const fullChain = [symbol.name, ...ancestors]

  if (components.length > fullChain.length) {
    return false
  }

  for (let i = 0; i < components.length; i++) {
    const isLastComponent = i === 0
    const useSubstring = substringMatching && isLastComponent

    if (!componentMatches(fullChain[i], components[components.length - 1 - i], useSubstring)) {
      return false
    }
  }

  // Absolute match: ensure no extra ancestors beyond the pattern
  if (isAbsolute && components.length !== fullChain.length) {
    return false
  }

  return true
}

/**
 * Match a memory path pattern against the symbol tree.
 * Inspired by Serena's NamePathMatcher with three matching modes:
 *
 * - Simple: "jwt" → any symbol named "jwt"
 * - Relative: "auth/jwt" → jwt under auth (suffix matching)
 * - Absolute: "/auth/jwt-tokens" → exact path match
 *
 * Substring matching applies to the LAST component only:
 * - "auth/refresh" matches "auth/jwt-tokens/refresh-token-rotation"
 *
 * @returns Matching symbols sorted by specificity (exact > relative > substring)
 */
export function matchMemoryPath(
  tree: MemorySymbolTree,
  pattern: string,
  options?: { substringMatching?: boolean },
): PathMatchResult[] {
  const substringMatching = options?.substringMatching ?? true
  const trimmedPattern = pattern.trim()

  if (!trimmedPattern) {
    return []
  }

  const mode = detectMatchMode(trimmedPattern)
  const cleanPattern = trimmedPattern.replace(/^\/+/, '')
  const components = cleanPattern.split('/').filter(Boolean)

  if (components.length === 0) {
    return []
  }

  // Fast path: try direct lookup in symbolMap for exact path
  const directMatch = tree.symbolMap.get(cleanPattern)
  if (directMatch) {
    return [{ matchedSymbol: directMatch, matchType: 'absolute' }]
  }

  // Also try with .md extension for leaf lookups
  if (!cleanPattern.endsWith('.md')) {
    const withMd = tree.symbolMap.get(`${cleanPattern}.md`)
    if (withMd) {
      return [{ matchedSymbol: withMd, matchType: 'absolute' }]
    }
  }

  const results: PathMatchResult[] = []
  const isAbsolute = mode === 'absolute'

  // Traverse entire tree and test each symbol
  function traverse(symbol: MemorySymbol): void {
    // Try exact match first (no substring)
    if (matchesReversedComponents(symbol, components, isAbsolute, false)) {
      const matchType = isAbsolute ? 'absolute' : mode === 'relative' ? 'relative' : 'simple'
      results.push({ matchedSymbol: symbol, matchType })
    } else if (substringMatching && matchesReversedComponents(symbol, components, isAbsolute, true)) {
      results.push({ matchedSymbol: symbol, matchType: 'substring' })
    }

    for (const child of symbol.children) {
      traverse(child)
    }
  }

  for (const rootNode of tree.root) {
    traverse(rootNode)
  }

  // Sort by specificity: absolute > relative > simple > substring
  const specificity: Record<string, number> = {
    absolute: 0,
    relative: 1,
    simple: 2,
    substring: 3,
  }

  results.sort((a, b) => (specificity[a.matchType] ?? 4) - (specificity[b.matchType] ?? 4))

  return results
}

/**
 * Determine if a query string looks like it could be a symbolic path query.
 * Returns true if the query contains "/" or if a leading word matches a known domain.
 */
export function isPathLikeQuery(query: string, tree: MemorySymbolTree): boolean {
  if (query.includes('/')) {
    return true
  }

  // Check if the first word matches a known domain name
  const firstWord = query.split(/\s+/)[0]?.toLowerCase()
  if (!firstWord) {
    return false
  }

  for (const rootNode of tree.root) {
    if (rootNode.name.toLowerCase() === firstWord) {
      return true
    }
  }

  return false
}

/**
 * Parse a query into a symbolic scope prefix and a remaining text query.
 * Tries to match leading words against known domains/topics in the tree.
 *
 * Examples:
 *   "auth/jwt refresh strategy" → { scopePath: "auth/jwt", textQuery: "refresh strategy" }
 *   "auth jwt refresh"          → { scopePath: "auth", textQuery: "jwt refresh" }
 *   "random text query"         → { scopePath: undefined, textQuery: "random text query" }
 */
export function parseSymbolicQuery(query: string, tree: MemorySymbolTree): ParsedSymbolicQuery {
  const trimmed = query.trim()

  // Case 1: explicit path with "/" separator
  const slashIdx = trimmed.indexOf('/')
  if (slashIdx !== -1) {
    // Find where the path ends and text begins (first space after path segment)
    const afterSlash = trimmed.indexOf(' ', slashIdx)
    if (afterSlash === -1) {
      // Entire query is a path
      const pathPart = trimmed.replace(/^\/+/, '')
      const matches = matchMemoryPath(tree, pathPart, { substringMatching: false })

      if (matches.length > 0) {
        return { scopePath: matches[0].matchedSymbol.path, textQuery: '' }
      }

      return { scopePath: undefined, textQuery: trimmed }
    }

    const pathPart = trimmed.slice(0, afterSlash).replace(/^\/+/, '')
    const textPart = trimmed.slice(afterSlash + 1).trim()
    const matches = matchMemoryPath(tree, pathPart, { substringMatching: false })

    if (matches.length > 0) {
      return { scopePath: matches[0].matchedSymbol.path, textQuery: textPart }
    }

    return { scopePath: undefined, textQuery: trimmed }
  }

  // Case 2: space-separated words — try leading word(s) as scope
  const words = trimmed.split(/\s+/)

  // Try first word as domain
  if (words.length >= 2) {
    const firstWord = words[0].toLowerCase()

    for (const rootNode of tree.root) {
      if (rootNode.name.toLowerCase() === firstWord) {
        // Try first two words as domain/topic
        if (words.length >= 3) {
          const secondWord = words[1].toLowerCase()

          for (const child of rootNode.children) {
            if (child.name.toLowerCase() === secondWord) {
              return {
                scopePath: child.path,
                textQuery: words.slice(2).join(' '),
              }
            }
          }
        }

        return {
          scopePath: rootNode.path,
          textQuery: words.slice(1).join(' '),
        }
      }
    }
  }

  return { scopePath: undefined, textQuery: trimmed }
}
