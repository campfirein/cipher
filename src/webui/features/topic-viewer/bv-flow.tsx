import type {BvProps} from './types'

export function BvFlow({children}: BvProps) {
  return (
    <div className="bv-flow-block">
      <span className="bv-flow-block__label">Flow</span>
      <div className="bv-flow-block__body">{children}</div>
    </div>
  )
}
