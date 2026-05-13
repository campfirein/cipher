import type {Element} from 'html-react-parser'

import {oneLight, SyntaxHighlighter} from '../../lib/syntax-highlighter'
import {isTagNode} from './dom-utils'

const textOf = (node: Element): string => {
  let out = ''
  for (const child of node.children) {
    if (child.type === 'text' && 'data' in child && typeof child.data === 'string') {
      out += child.data
    } else if (isTagNode(child)) {
      out += textOf(child)
    }
  }

  return out
}

/**
 * Extracts a language token (e.g. "ts", "javascript") from a `<code>` element's
 * className: looks for the `language-xxx` Prism convention.
 */
const languageFrom = (className: string | undefined): string | undefined => {
  if (!className) return undefined
  const match = /\blanguage-([\w-]+)/.exec(className)
  return match ? match[1] : undefined
}

interface CodeBlockProps {
  code: string
  language: string
}

export function CodeBlock({code, language}: CodeBlockProps) {
  return (
    <SyntaxHighlighter
      codeTagProps={{style: {fontFamily: 'var(--font-mono)', fontSize: '12.5px'}}}
      customStyle={{
        background: 'var(--muted)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        margin: '12px 0',
        padding: '12px 14px',
      }}
      language={language}
      PreTag="div"
      style={oneLight}
    >
      {code}
    </SyntaxHighlighter>
  )
}

/**
 * Detects the `<pre><code class="language-*">` pattern. Returns `{code, language}`
 * if matched, otherwise `undefined` so the caller can fall through to default
 * rendering (a plain styled `<pre>`).
 */
export function detectCodeBlock(node: Element): undefined | {code: string; language: string} {
  if (node.tagName !== 'pre') return undefined

  // Pre tags may have whitespace text-node siblings between children — find the code child.
  const codeChild = node.children.find((c): c is Element => isTagNode(c) && c.tagName === 'code')
  if (!codeChild) return undefined

  const language = languageFrom(codeChild.attribs?.class)
  if (!language) return undefined

  const code = textOf(codeChild).replace(/\n$/, '')
  return {code, language}
}
