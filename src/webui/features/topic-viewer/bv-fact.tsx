import {Children} from 'react'

import type {BvProps} from './types'

const CATEGORIES = new Set(['convention', 'environment', 'other', 'personal', 'preference', 'project', 'team'])

const isEmpty = (children: BvProps['children']): boolean => {
  const arr = Children.toArray(children)
  if (arr.length === 0) return true
  return arr.every((c) => typeof c === 'string' && c.trim() === '')
}

export function BvFact({attrs, children}: BvProps) {
  const {category, subject, value} = attrs
  const categoryLabel = category && CATEGORIES.has(category) ? category : undefined

  // Fall back to a templated sentence when no text body is authored.
  const body = isEmpty(children) && (subject || value) ? `${subject ?? ''} is ${value ?? ''}.` : children

  return (
    <li className="border-border flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b py-3 last:border-b-0">
      <span className="bv-prose text-foreground flex-1 text-sm leading-6">{body}</span>
      {categoryLabel && (
        <span className="text-muted-foreground text-[11px] uppercase tracking-[0.06em]">{categoryLabel}</span>
      )}
    </li>
  )
}
