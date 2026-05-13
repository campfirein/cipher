import mermaid from 'mermaid'
import {type ReactNode, useEffect, useRef, useState} from 'react'

import {childrenToString} from './dom-utils'

let initialized = false
const ensureInitialized = () => {
  if (initialized) return
  // Topic viewer is always rendered on light editorial paper, regardless of
  // the surrounding dashboard's `<html class="dark">`. Force the light theme.
  mermaid.initialize({
    securityLevel: 'strict',
    startOnLoad: false,
    theme: 'default',
  })
  initialized = true
}

let counter = 0
const nextId = () => {
  counter += 1
  return `bv-mermaid-${counter}`
}

interface MermaidProps {
  children: ReactNode
}

export function Mermaid({children}: MermaidProps) {
  const source = childrenToString(children)
  // eslint-disable-next-line no-undef
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    const id = nextId()

    const run = async () => {
      try {
        ensureInitialized()
        const {svg} = await mermaid.render(id, source)
        if (cancelled || !containerRef.current) return
        containerRef.current.innerHTML = svg
        setError(undefined)
      } catch (error_: unknown) {
        if (cancelled) return
        setError(error_ instanceof Error ? error_.message : 'Failed to render diagram')
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [source])

  if (error) {
    return (
      <div className="space-y-2">
        <div className="text-destructive text-[12px]">Diagram render failed: {error}</div>
        <pre className="bg-muted border-border rounded-md border p-3 font-mono text-[12.5px]">
          <code>{source}</code>
        </pre>
      </div>
    )
  }

  return <div className="bv-mermaid overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full" ref={containerRef} />
}
