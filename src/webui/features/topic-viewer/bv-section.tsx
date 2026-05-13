import type {BvProps} from './types'

interface LabelPair {
  eyebrow: string
  title: string
}

const LABELS: Record<string, LabelPair> = {
  'bv-changes': {eyebrow: 'Changes', title: 'What changed'},
  'bv-dependencies': {eyebrow: 'Dependencies', title: 'What it depends on'},
  'bv-examples': {eyebrow: 'Examples', title: 'How to use it'},
  'bv-files': {eyebrow: 'Files', title: 'Where things live'},
  'bv-highlights': {eyebrow: 'Highlights', title: 'Key points'},
  'bv-reason': {eyebrow: 'Why', title: 'Why this topic exists'},
  'bv-structure': {eyebrow: 'How', title: "How it's organized"},
}

interface BvSectionProps extends BvProps {
  tag: string
}

export function BvSection({children, tag}: BvSectionProps) {
  const label = LABELS[tag] ?? {eyebrow: tag, title: tag}
  return (
    <section className="bv-section-block" id={tag}>
      <div className="bv-section-head">
        <span className="bv-eyebrow">{label.eyebrow}</span>
        <h2>{label.title}</h2>
      </div>
      <div className="bv-prose text-sm leading-6">{children}</div>
    </section>
  )
}
