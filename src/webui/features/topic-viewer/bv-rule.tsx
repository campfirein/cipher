import type {BvProps} from './types'

type Severity = 'info' | 'must' | 'should'

const SEVERITY_LABEL: Record<Severity, string> = {
  info: 'for reference',
  must: 'must',
  should: 'should',
}

const SEVERITY_DOT_VAR: Record<Severity, string> = {
  info: 'var(--sage)',
  must: 'var(--terra)',
  should: 'var(--ochre)',
}

const isSeverity = (value: string | undefined): value is Severity =>
  value === 'must' || value === 'should' || value === 'info'

export function BvRule({attrs, children}: BvProps) {
  const severity = isSeverity(attrs.severity) ? attrs.severity : undefined

  return (
    <div className="bv-rule-item">
      <span className="bv-rule-item__num" />
      <div className="bv-rule-item__body">
        {severity && (
          <span className="bv-rule-item__sev">
            <span
              aria-hidden
              className="bv-rule-item__dot"
              style={{background: SEVERITY_DOT_VAR[severity]}}
            />
            {SEVERITY_LABEL[severity]}
          </span>
        )}
        <span className="bv-rule-item__text bv-prose">{children}</span>
      </div>
    </div>
  )
}
