import {type DOMNode, domToReact, type Element} from 'html-react-parser'
import {Fragment, type ReactNode, useMemo} from 'react'

import type {BvNodeProps} from './types'

import {BvFact} from './bv-fact'
import {BvField} from './bv-field'
import {BvPattern} from './bv-pattern'
import {BvRule} from './bv-rule'
import {isTagNode} from './dom-utils'
import {groupSiblings} from './group'

const splitCsv = (value: string | undefined): string[] =>
  value
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []

const formatDate = (iso: string | undefined): string | undefined => {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'})
}

const findAuthorIn = (nodes: DOMNode[]): string | undefined => {
  for (const n of nodes) {
    if (!isTagNode(n)) continue
    if (n.tagName === 'bv-author') {
      const text = n.children
        .map((c) => (c.type === 'text' && 'data' in c ? c.data : ''))
        .join('')
        .trim()
      if (text) return text
    }
  }

  return undefined
}

export function BvTopic({node, options}: BvNodeProps) {
  const attrs = node.attribs
  const tags = splitCsv(attrs.tags)
  const keywords = splitCsv(attrs.keywords)
  const related = splitCsv(attrs.related)
  const updated = formatDate(attrs.updatedat)
  const created = formatDate(attrs.createdat)

  const childrenAsDom = node.children as DOMNode[]
  const groups = useMemo(() => groupSiblings(childrenAsDom), [childrenAsDom])
  const author = useMemo(() => findAuthorIn(childrenAsDom), [childrenAsDom])

  const updatedLabel = updated ?? created
  const hasColophon =
    tags.length > 0 || keywords.length > 0 || related.length > 0 || Boolean(updatedLabel) || Boolean(attrs.path)

  const crumbs = attrs.path?.split('/').filter(Boolean) ?? []
  const crumbHrefs = crumbs.map((_, i) => `/contexts?path=${encodeURIComponent(crumbs.slice(0, i + 1).join('/'))}`)

  return (
    <div className="bv-editorial">
      <article className="bv-article">
        <header className="bv-masthead">
          {crumbs.length > 0 && (
            <div className="bv-crumbs">
              <a href="/contexts">topics</a>
              {crumbs.map((c, i) => (
                <Fragment key={i}>
                  <span className="sep">›</span>
                  {i === crumbs.length - 1 ? <span>{c}</span> : <a href={crumbHrefs[i]}>{c}</a>}
                </Fragment>
              ))}
            </div>
          )}
          {attrs.title && <h1 className="bv-topic-title">{attrs.title}</h1>}
          {attrs.summary && <p className="bv-lede">{attrs.summary}</p>}

          {(updatedLabel || author) && (
            <div className="bv-status">
              {updatedLabel && (
                <span className="bv-status__item">
                  <span>Updated</span>
                  <span className="bv-status__value">{updatedLabel}</span>
                </span>
              )}
              {author && (
                <span className="bv-status__item">
                  <span>Author</span>
                  <span className="bv-status__value bv-status__value--italic">{author}</span>
                </span>
              )}
            </div>
          )}
        </header>

        <div className="bv-body">
          {groups.map((g, i) => (
            <Fragment key={i}>{renderGroup(g.kind, g.nodes, options, i, i === 0)}</Fragment>
          ))}
        </div>

        {hasColophon && (
          <Colophon
            author={author}
            created={created}
            keywords={keywords}
            path={attrs.path}
            related={related}
            tags={tags}
            updated={updated}
          />
        )}
      </article>
    </div>
  )
}

interface ColophonProps {
  author: string | undefined
  created: string | undefined
  keywords: string[]
  path: string | undefined
  related: string[]
  tags: string[]
  updated: string | undefined
}

function Colophon({author, created, keywords, path, related, tags, updated}: ColophonProps) {
  return (
    <footer className="bv-colophon">
      <span className="bv-eyebrow">Colophon</span>
      <dl>
        {path && (
          <>
            <dt>Path</dt>
            <dd className="bv-colophon__mono">{path}</dd>
          </>
        )}
        {tags.length > 0 && (
          <>
            <dt>Tags</dt>
            <dd>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    className="rounded-full border-[1.5px] px-2.5 py-0.5 text-xs"
                    key={t}
                    style={{background: 'var(--page)', borderColor: 'var(--hair)'}}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </dd>
          </>
        )}
        {keywords.length > 0 && (
          <>
            <dt>Keywords</dt>
            <dd style={{color: 'var(--ink-soft)', fontSize: '14px'}}>{keywords.join(' · ')}</dd>
          </>
        )}
        {related.length > 0 && (
          <>
            <dt>Related</dt>
            <dd>
              <div className="flex flex-wrap gap-1.5">
                {related.map((r) => (
                  <span
                    className="rounded-full border-[1.5px] px-2.5 py-0.5 font-mono text-xs"
                    key={r}
                    style={{background: 'var(--page)', borderColor: 'var(--sage)', color: 'var(--sage-d)'}}
                  >
                    {r}
                  </span>
                ))}
              </div>
            </dd>
          </>
        )}
        {(author || created || updated) && (
          <>
            <dt>Authored</dt>
            <dd className="bv-colophon__italic">
              {author && <>By {author}</>}
              {author && (created || updated) && <> · </>}
              {created && <>created {created}</>}
              {created && updated && <> · </>}
              {updated && !created && <>updated {updated}</>}
              {created && updated && <>last tended on {updated}</>}
            </dd>
          </>
        )}
      </dl>
    </footer>
  )
}

function renderGroup(
  kind: ReturnType<typeof groupSiblings>[number]['kind'],
  nodes: DOMNode[],
  options: import('html-react-parser').HTMLReactParserOptions,
  key: number,
  isFirst: boolean,
): ReactNode {
  const elementNodes = nodes.filter((n): n is Element => isTagNode(n))

  if (kind === 'fields') return <FieldsBlock isFirst={isFirst} key={key} nodes={elementNodes} options={options} />
  if (kind === 'facts') return <FactsBlock isFirst={isFirst} key={key} nodes={elementNodes} options={options} />
  if (kind === 'rules') return <RulesBlock isFirst={isFirst} key={key} nodes={elementNodes} options={options} />
  if (kind === 'patterns') return <PatternsBlock isFirst={isFirst} key={key} nodes={elementNodes} options={options} />
  if (kind === 'fieldnotes') return <FieldNotesBlock key={key} nodes={nodes} options={options} />
  return (
    <div className={`bv-section-block ${isFirst ? 'bv-section-block--lead' : ''}`} key={key}>
      {domToReact(nodes, options)}
    </div>
  )
}

function FieldNotesBlock({
  nodes,
  options,
}: {
  nodes: DOMNode[]
  options: import('html-react-parser').HTMLReactParserOptions
}) {
  return (
    <section className="bv-section-block" id="field-notes">
      <div className="bv-section-head">
        <span className="bv-eyebrow">Field notes</span>
        <h2>What we have observed</h2>
      </div>
      <div>{domToReact(nodes, options)}</div>
    </section>
  )
}

interface GroupProps {
  isFirst: boolean
  nodes: Element[]
  options: import('html-react-parser').HTMLReactParserOptions
}

function SectionShell({
  children,
  count,
  eyebrow,
  id,
  title,
}: {
  children: ReactNode
  count?: number
  eyebrow: string
  id: string
  title: string
}) {
  return (
    <section className="bv-section-block" id={id}>
      <div className="bv-section-head">
        <span className="bv-eyebrow">
          {eyebrow}
          {count !== undefined && ` · ${count} ${count === 1 ? 'item' : 'items'}`}
        </span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  )
}

function FieldsBlock({nodes, options}: GroupProps) {
  return (
    <SectionShell count={nodes.length} eyebrow="Concept" id="raw-concept" title="Operating notes">
      <dl className="grid grid-cols-[80px_1fr] gap-x-5 gap-y-3 text-sm" style={{color: 'var(--ink)'}}>
        {nodes.map((n, i) => (
          <BvField attrs={n.attribs} key={i} tag={n.tagName}>
            {domToReact(n.children as DOMNode[], options)}
          </BvField>
        ))}
      </dl>
    </SectionShell>
  )
}

function FactsBlock({nodes, options}: GroupProps) {
  return (
    <SectionShell count={nodes.length} eyebrow="Facts" id="facts" title="What's true today">
      <ul className="m-0 list-none p-0">
        {nodes.map((n, i) => (
          <BvFact attrs={n.attribs} key={i}>
            {domToReact(n.children as DOMNode[], options)}
          </BvFact>
        ))}
      </ul>
    </SectionShell>
  )
}

function RulesBlock({nodes, options}: GroupProps) {
  return (
    <SectionShell count={nodes.length} eyebrow="Rules" id="rules" title="What we always do">
      <div>
        {nodes.map((n, i) => (
          <BvRule attrs={n.attribs} key={i}>
            {domToReact(n.children as DOMNode[], options)}
          </BvRule>
        ))}
      </div>
    </SectionShell>
  )
}

function PatternsBlock({nodes, options}: GroupProps) {
  return (
    <SectionShell count={nodes.length} eyebrow="Patterns" id="patterns" title="Strings we look for">
      <div className="grid gap-2">
        {nodes.map((n, i) => (
          <BvPattern attrs={n.attribs} key={i}>
            {domToReact(n.children as DOMNode[], options)}
          </BvPattern>
        ))}
      </div>
    </SectionShell>
  )
}
