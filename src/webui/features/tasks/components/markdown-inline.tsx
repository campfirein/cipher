import {memo} from 'react'
import ReactMarkdown, {type Components} from 'react-markdown'
import remarkGfm from 'remark-gfm'

import {oneDark, SyntaxHighlighter} from '../../../lib/syntax-highlighter'

const COMPONENTS: Components = {
  a({children, href}) {
    return href ? (
      <a
        className="text-identifier underline-offset-2 hover:underline"
        href={href}
        rel="noopener noreferrer"
        target="_blank"
      >
        {children}
      </a>
    ) : (
      <>{children}</>
    )
  },
  blockquote({children}) {
    return <blockquote className="border-border text-muted-foreground border-l-2 pl-3 italic">{children}</blockquote>
  },
  code({children, className}) {
    const codeContent = String(children).replace(/\n$/, '')
    const langMatch = /language-(\w+)/.exec(className ?? '')
    const language = langMatch?.[1]
    const isMultiLine = codeContent.includes('\n')

    if (isMultiLine || language) {
      return (
        <div className="border-border/50 bg-muted/40 my-2 overflow-x-auto rounded-md border">
          <SyntaxHighlighter
            codeTagProps={{
              style: {fontFamily: 'ui-monospace, SF Mono, Menlo, Consolas, monospace', fontSize: '0.75rem'},
            }}
            customStyle={{
              background: 'transparent',
              fontSize: '0.75rem',
              lineHeight: 1.6,
              margin: 0,
              padding: '0.75rem',
            }}
            language={language ?? 'plaintext'}
            PreTag="div"
            style={oneDark}
          >
            {codeContent}
          </SyntaxHighlighter>
        </div>
      )
    }

    return <code className="bg-muted/60 rounded px-1 py-0.5 mono text-[0.85em] text-zinc-200">{children}</code>
  },
  h1({children}) {
    return <h1 className="text-foreground mt-3 mb-2 text-base font-semibold">{children}</h1>
  },
  h2({children}) {
    return <h2 className="text-foreground mt-3 mb-2 text-sm font-semibold">{children}</h2>
  },
  h3({children}) {
    return <h3 className="text-foreground mt-3 mb-2 text-sm font-semibold">{children}</h3>
  },
  li({children}) {
    return <li className="my-0.5 leading-relaxed">{children}</li>
  },
  ol({children}) {
    return <ol className="my-2 list-inside list-decimal space-y-1 pl-1">{children}</ol>
  },
  p({children}) {
    return <p className="my-1.5 leading-relaxed first:mt-0 last:mb-0">{children}</p>
  },
  ul({children}) {
    return <ul className="my-2 list-inside list-disc space-y-1 pl-1">{children}</ul>
  },
}

const REMARK_PLUGINS = [remarkGfm]

interface MarkdownInlineProps {
  children: string
  className?: string
}

export const MarkdownInline = memo(({children, className}: MarkdownInlineProps) => (
  <div className={className ?? 'text-foreground/90 text-sm'}>
    <ReactMarkdown components={COMPONENTS} remarkPlugins={REMARK_PLUGINS}>
      {children}
    </ReactMarkdown>
  </div>
))
MarkdownInline.displayName = 'MarkdownInline'
