import type {DOMNode, Element} from 'html-react-parser'
import type {ReactNode} from 'react'

import {Children} from 'react'

export const isTagNode = (node: unknown): node is Element =>
  typeof node === 'object' &&
  node !== null &&
  (node as DOMNode).type === 'tag' &&
  'attribs' in node &&
  'tagName' in node

/** First non-whitespace child element of `el`, or undefined if there isn't one. */
export const firstSignificantChild = (el: Element): Element | undefined => {
  for (const child of el.children) {
    if (child.type === 'text' && 'data' in child && typeof child.data === 'string' && child.data.trim() === '') {
      continue
    }

    return isTagNode(child) ? child : undefined
  }

  return undefined
}

/** Find the first sibling tag with `tagName` inside an element's parent. */
export const findSiblingByTag = (node: Element, tagName: string): Element | undefined => {
  const {parent} = node
  if (!parent || !('children' in parent)) return undefined
  const siblings = (parent.children as DOMNode[]) ?? []
  return siblings.find((c): c is Element => isTagNode(c) && c.tagName === tagName)
}

/** Flatten React children into a trimmed plain-text string. */
export const childrenToString = (children: ReactNode): string =>
  Children.toArray(children)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : ''))
    .join('')
    .trim()
