import {type DefaultTreeAdapterMap, parseFragment, serialize} from 'parse5'

import type {DocumentNode, ElementNode, ParsedNode} from '../../../core/domain/render/element-types.js'

/**
 * HTML parser wrapper around parse5.
 *
 * Produces a normalized AST (`DocumentNode` / `ElementNode` /
 * `TextNode`) independent of parse5's internal types so consumers
 * (T4 query reader, T3 round-trip validation, future indexers) can
 * iterate without coupling to a specific HTML library.
 *
 * Why parse5 — it's the W3C-spec parser used by jsdom; widely vetted;
 * forgiving on malformed input by design (a feature for migration
 * tooling, neutral for M1 light validation).
 *
 * v1 parses everything as a fragment (no `<html>`/`<head>`/`<body>`
 * wrapper required). M2 may add document-level parsing if topic files
 * grow document-shaped headers; the wrapper gives us room.
 */

type Parse5DocumentFragment = DefaultTreeAdapterMap['documentFragment']
type Parse5Node = DefaultTreeAdapterMap['node']
type Parse5Element = DefaultTreeAdapterMap['element']
type Parse5TextNode = DefaultTreeAdapterMap['textNode']

/**
 * Parse an HTML string into a normalized `DocumentNode`. parse5's
 * forgiving mode means malformed input returns a best-effort tree
 * rather than throwing.
 */
export function parseHtml(html: string): DocumentNode {
  const fragment: Parse5DocumentFragment = parseFragment(html)
  const children = fragment.childNodes
    .map((c) => convertNode(c))
    .filter((n): n is ParsedNode => n !== undefined)
  return {children, type: 'document'}
}

/**
 * Walk a parsed tree depth-first, returning every element node in
 * document order. Used by element-axis indexing (T4) and by validators
 * that need to find typed elements anywhere in the tree.
 */
export function walkElements(root: ParsedNode): ElementNode[] {
  const out: ElementNode[] = []
  walk(root, out)
  return out
}

function walk(node: ParsedNode, out: ElementNode[]): void {
  if (node.type === 'element') out.push(node)
  if (node.type === 'element' || node.type === 'document') {
    for (const child of node.children) walk(child, out)
  }
}

/**
 * Concatenate all text-node descendants of an element into a single
 * string. Used to extract BM25-ready text content from typed elements
 * (T4). HTML entities are already decoded by parse5, so the output is
 * usable verbatim by the tokenizer.
 */
export function getInnerText(node: ParsedNode): string {
  if (node.type === 'text') return node.text
  if (node.type === 'element' || node.type === 'document') {
    return node.children.map((c) => getInnerText(c)).join('')
  }

  return ''
}

/**
 * Serialize a normalized tree back to HTML. Used for round-trip
 * validation in tests and for the writer's emit path (T3).
 *
 * Note: serialization is semantically equivalent, not byte-equivalent.
 * Whitespace, attribute quoting, and self-closing tag style may
 * normalize.
 */
export function serializeHtml(root: DocumentNode): string {
  // Convert our normalized tree back to parse5's shape, then call serialize.
  const fragment = toParse5Fragment(root)
  return serialize(fragment)
}

// ----- internal: parse5 → normalized -----

function convertNode(node: Parse5Node): ParsedNode | undefined {
  if (isTextNode(node)) {
    return {text: node.value, type: 'text'}
  }

  if (isElementNode(node)) {
    const attributes: Record<string, string> = {}
    for (const attr of node.attrs) {
      attributes[attr.name] = attr.value
    }

    const children = node.childNodes
      .map((c) => convertNode(c))
      .filter((c): c is ParsedNode => c !== undefined)

    return {
      attributes,
      children,
      tagName: node.tagName.toLowerCase(),
      type: 'element',
    }
  }

  // Skip comments, doctype, processing instructions, etc. for M1.
  return undefined
}

function isTextNode(node: Parse5Node): node is Parse5TextNode {
  return node.nodeName === '#text'
}

function isElementNode(node: Parse5Node): node is Parse5Element {
  return 'tagName' in node && 'attrs' in node && 'childNodes' in node
}

// ----- internal: normalized → parse5 (for serialize) -----

type MutableParse5Element = {
  attrs: Array<{name: string; value: string}>
  childNodes: Array<MutableParse5Element | MutableParse5Text>
  namespaceURI: string
  nodeName: string
  parentNode: null
  tagName: string
}

type MutableParse5Text = {
  nodeName: '#text'
  parentNode: null
  value: string
}

type MutableParse5Fragment = {
  childNodes: Array<MutableParse5Element | MutableParse5Text>
  nodeName: '#document-fragment'
}

const HTML_NS = 'http://www.w3.org/1999/xhtml'

function toParse5Fragment(doc: DocumentNode): Parse5DocumentFragment {
  const fragment: MutableParse5Fragment = {
    childNodes: doc.children.map((c) => toParse5Node(c)).filter((n): n is MutableParse5Element | MutableParse5Text => n !== undefined),
    nodeName: '#document-fragment',
  }
  // parse5's serialize accepts any object with nodeName + childNodes; type
  // assertion is the contained boundary between our normalized tree and
  // parse5's expected input.
  return fragment as unknown as Parse5DocumentFragment
}

function toParse5Node(node: ParsedNode): MutableParse5Element | MutableParse5Text | undefined {
  if (node.type === 'text') {
    return {nodeName: '#text', parentNode: null, value: node.text}
  }

  if (node.type === 'element') {
    return {
      attrs: Object.entries(node.attributes).map(([name, value]) => ({name, value})),
      childNodes: node.children
        .map((c) => toParse5Node(c))
        .filter((n): n is MutableParse5Element | MutableParse5Text => n !== undefined),
      namespaceURI: HTML_NS,
      nodeName: node.tagName,
      parentNode: null,
      tagName: node.tagName,
    }
  }

  // DocumentNode shouldn't appear inside a tree (it's the root only)
  return undefined
}
