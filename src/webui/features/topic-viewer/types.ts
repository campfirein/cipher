import type { Element, HTMLReactParserOptions} from 'html-react-parser'
import type {ReactNode} from 'react'

export type BvAttrs = Readonly<Record<string, string>>

export interface BvProps {
  attrs: BvAttrs
  children: ReactNode
}

export interface BvNodeProps {
  node: Element
  options: HTMLReactParserOptions
}

export const BV_TAGS = [
  'bv-topic',
  'bv-reason',
  'bv-task',
  'bv-changes',
  'bv-files',
  'bv-flow',
  'bv-timestamp',
  'bv-author',
  'bv-pattern',
  'bv-structure',
  'bv-dependencies',
  'bv-highlights',
  'bv-rule',
  'bv-examples',
  'bv-diagram',
  'bv-fact',
  'bv-decision',
  'bv-bug',
  'bv-fix',
] as const

export type BvTag = (typeof BV_TAGS)[number]

export const isBvTag = (tag: string): tag is BvTag => (BV_TAGS as readonly string[]).includes(tag)



export {type DOMNode, type Element, type HTMLReactParserOptions} from 'html-react-parser'