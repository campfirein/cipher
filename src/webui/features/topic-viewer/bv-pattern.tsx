import type {BvProps} from './types'

import {childrenToString} from './dom-utils'

const capitalize = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

export function BvPattern({attrs, children}: BvProps) {
  const {description, flags} = attrs
  const source = childrenToString(children)
  const wrapped = source ? `/${source}/${flags ?? ''}` : ''
  const label = capitalize(description || (source ? 'Pattern' : ''))

  return (
    <div className="bv-pattern-card">
      <span className="bv-pattern-card__label">{label}</span>
      {wrapped && <code className="bv-pattern-card__source">{wrapped}</code>}
    </div>
  )
}
