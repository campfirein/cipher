import parse, {type DOMNode, domToReact, type HTMLReactParserOptions} from 'html-react-parser'
import {type ReactElement, type ReactNode, useMemo, useState} from 'react'

import type {BvProps} from './types'

import {oneLight, SyntaxHighlighter} from '../../lib/syntax-highlighter'
import {BvBug, BvDecision, BvDiagram, BvFix} from './bv-callout'
import {BvFact} from './bv-fact'
import {BvFlow} from './bv-flow'
import {BvPattern} from './bv-pattern'
import {BvRule} from './bv-rule'
import {BvSection} from './bv-section'
import {BvTask} from './bv-task'
import {BvTopic} from './bv-topic'
import {CodeBlock, detectCodeBlock} from './code-block'
import {findSiblingByTag, firstSignificantChild, isTagNode} from './dom-utils'
import './prose.css'
import './editorial.css'

type SimpleBvComponent = (props: BvProps) => ReactNode

const SECTION_TAGS = new Set([
  'bv-changes',
  'bv-dependencies',
  'bv-examples',
  'bv-files',
  'bv-highlights',
  'bv-reason',
  'bv-structure',
])

const SIMPLE_COMPONENTS: Record<string, SimpleBvComponent> = {
  'bv-bug': BvBug,
  'bv-decision': BvDecision,
  'bv-diagram': BvDiagram,
  'bv-fact': BvFact,
  'bv-fix': BvFix,
  'bv-flow': BvFlow,
  'bv-pattern': BvPattern,
  'bv-rule': BvRule,
  'bv-task': BvTask,
}

/* Hidden from standalone rendering — surfaced elsewhere:
 *   bv-author / bv-timestamp → Colophon footer.
 *   bv-task                  → folded into bv-reason ("Why").
 *   bv-flow                  → folded into bv-structure ("How"). */
const HIDDEN_TAGS = new Set(['bv-author', 'bv-flow', 'bv-task', 'bv-timestamp'])

/** Map a section tag to a sibling tag whose content is rendered inside it. */
const SECTION_SIBLING: Record<string, {component: SimpleBvComponent; tag: string}> = {
  'bv-reason': {component: BvTask, tag: 'bv-task'},
  'bv-structure': {component: BvFlow, tag: 'bv-flow'},
}

const isSafeUrl = (value: string): boolean => /^(?:https?:|mailto:|#|\/)/i.test(value)

/** A <ul> is a definition list when every <li> opens with <strong>. */
const isTermPrefixedList = (node: import('html-react-parser').Element): boolean => {
  const items = node.children.filter((c) => isTagNode(c) && c.tagName === 'li')
  if (items.length === 0) return false
  return items.every((li) => {
    const first = firstSignificantChild(li as import('html-react-parser').Element)
    return Boolean(first && first.tagName === 'strong')
  })
}

// Built once at module load — the `replace` callback only depends on a self-
// reference to `options` (for recursive `domToReact`), not on per-render input.
const options: HTMLReactParserOptions = {
  replace(node) {
    if (!isTagNode(node)) return

    if (HIDDEN_TAGS.has(node.tagName)) return <></>

    if (node.tagName === 'bv-topic') {
      return <BvTopic node={node} options={options} />
    }

    if (SECTION_TAGS.has(node.tagName)) {
      return renderSection(node)
    }

    const Simple = SIMPLE_COMPONENTS[node.tagName]
    if (Simple) {
      return <Simple attrs={node.attribs}>{domToReact(node.children as DOMNode[], options)}</Simple>
    }

    return renderHtmlPassthrough(node)
  },
}

function renderSection(node: import('html-react-parser').Element): ReactElement {
  const pairing = SECTION_SIBLING[node.tagName]
  const sibling = pairing ? findSiblingByTag(node, pairing.tag) : undefined
  const Sibling = pairing?.component
  return (
    <BvSection attrs={node.attribs} tag={node.tagName}>
      {domToReact(node.children as DOMNode[], options)}
      {Sibling && sibling && (
        <Sibling attrs={sibling.attribs}>{domToReact(sibling.children as DOMNode[], options)}</Sibling>
      )}
    </BvSection>
  )
}

function renderHtmlPassthrough(node: import('html-react-parser').Element): ReactElement | undefined {
  if (node.tagName === 'a') {
    const {href} = node.attribs
    if (!href || !isSafeUrl(href)) return <>{domToReact(node.children as DOMNode[], options)}</>

    return (
      <a href={href} rel="noopener noreferrer" target="_blank" title={node.attribs.title}>
        {domToReact(node.children as DOMNode[], options)}
      </a>
    )
  }

  if (node.tagName === 'img') {
    const {src} = node.attribs
    if (!src || !isSafeUrl(src)) return <></>
    return <img alt={node.attribs.alt ?? ''} src={src} title={node.attribs.title} />
  }

  if (node.tagName === 'pre') {
    const detected = detectCodeBlock(node)
    if (detected) return <CodeBlock code={detected.code} language={detected.language} />
  }

  if (node.tagName === 'ul' && isTermPrefixedList(node)) {
    return <ul className="bv-deflist">{domToReact(node.children as DOMNode[], options)}</ul>
  }

  return undefined
}

export interface TopicViewerProps {
  html: string
}

type ViewMode = 'code' | 'preview'

export function TopicViewer({html}: TopicViewerProps) {
  const [mode, setMode] = useState<ViewMode>('preview')
  const tree = useMemo(() => parse(html, options), [html])

  return (
    <div className="bv-topic-viewer">
      <ModeToggle mode={mode} onChange={setMode} />
      {mode === 'preview' ? <>{tree}</> : <CodeSource html={html} />}
    </div>
  )
}

function ModeToggle({mode, onChange}: {mode: ViewMode; onChange: (m: ViewMode) => void}) {
  return (
    <div aria-label="View mode" className="bv-mode-toggle" role="group">
      <button
        aria-pressed={mode === 'preview'}
        className="bv-mode-toggle__button"
        onClick={() => onChange('preview')}
        type="button"
      >
        Preview
      </button>
      <button
        aria-pressed={mode === 'code'}
        className="bv-mode-toggle__button"
        onClick={() => onChange('code')}
        type="button"
      >
        Code
      </button>
    </div>
  )
}

function CodeSource({html}: {html: string}) {
  return (
    <div className="bv-code-source">
      <SyntaxHighlighter
        codeTagProps={{style: {fontFamily: 'var(--font-mono)', fontSize: '12.5px'}}}
        customStyle={{
          background: 'transparent',
          border: 0,
          borderRadius: 0,
          margin: 0,
          padding: '20px 24px',
        }}
        language="markup"
        PreTag="div"
        style={oneLight}
        wrapLongLines
      >
        {html}
      </SyntaxHighlighter>
    </div>
  )
}
