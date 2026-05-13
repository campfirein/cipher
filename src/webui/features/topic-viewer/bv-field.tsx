import type {BvProps} from './types'

const LABELS: Record<string, string> = {
  'bv-author': 'Author',
  'bv-flow': 'Flow',
  'bv-task': 'Task',
  'bv-timestamp': 'Date',
}

interface BvFieldProps extends BvProps {
  tag: string
}

const MONO_TAGS = new Set(['bv-timestamp'])

export function BvField({children, tag}: BvFieldProps) {
  const label = LABELS[tag] ?? tag
  const valueClass = MONO_TAGS.has(tag) ? 'font-mono text-[13px]' : 'text-sm'
  return (
    <>
      <dt className="text-muted-foreground pt-0.5 text-xs font-medium">{label}</dt>
      <dd className={`m-0 ${valueClass}`}>{children}</dd>
    </>
  )
}
