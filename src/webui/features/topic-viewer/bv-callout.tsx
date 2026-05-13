import {type ReactNode} from 'react'

import type {BvProps} from './types'

import {Mermaid} from './mermaid'

type Tone = 'bug' | 'decision' | 'diagram' | 'fix'

interface CalloutProps {
  children: ReactNode
  kind: string
  severity?: string
  title?: string
  tone: Tone
}

function Callout({children, kind, severity, title, tone}: CalloutProps) {
  return (
    <div className={`bv-callout-card bv-callout-card--${tone}`}>
      <div className="bv-callout-card__kind">
        <span className="label">{kind}</span>
        {severity && <span className="bv-callout-card__sev">{severity}</span>}
      </div>
      {title && <h3 className="bv-callout-card__title">{title}</h3>}
      <div className="bv-callout-card__body bv-prose">{children}</div>
    </div>
  )
}

export function BvDecision({attrs, children}: BvProps) {
  return (
    <Callout kind="Decision" title={attrs.title} tone="decision">
      {children}
    </Callout>
  )
}

export function BvBug({attrs, children}: BvProps) {
  return (
    <Callout kind="Bug" severity={attrs.severity} title={attrs.title} tone="bug">
      {children}
    </Callout>
  )
}

export function BvFix({attrs, children}: BvProps) {
  return (
    <Callout kind="Fix" title={attrs.title} tone="fix">
      {children}
    </Callout>
  )
}

export function BvDiagram({attrs, children}: BvProps) {
  const isMermaid = attrs.type === 'mermaid'
  return (
    <section className="bv-section-block" id="bv-diagram">
      <div className="bv-section-head">
        <span className="bv-eyebrow">Diagram</span>
        {attrs.title && <h2>{attrs.title}</h2>}
      </div>
      <figure className="bv-diagram-frame">
        <div className="bv-diagram-frame__art">
          {isMermaid ? <Mermaid>{children}</Mermaid> : <pre className="bv-diagram-frame__source">{children}</pre>}
        </div>
        {attrs.type && (
          <figcaption className="bv-diagram-frame__caption">
            <span className="bv-diagram-frame__type">{attrs.type}</span>
          </figcaption>
        )}
      </figure>
    </section>
  )
}
