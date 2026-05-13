import type {DOMNode} from 'html-react-parser'

type GroupKind = 'facts' | 'fieldnotes' | 'fields' | 'passthrough' | 'patterns' | 'rules'

export interface NodeGroup {
  kind: GroupKind
  nodes: DOMNode[]
}

const FIELD_TAGS = new Set<string>()
const FIELD_NOTE_TAGS = new Set(['bv-bug', 'bv-decision', 'bv-fix'])

const tagNameOf = (node: DOMNode): string | undefined =>
  node.type === 'tag' && 'tagName' in node && typeof node.tagName === 'string' ? node.tagName : undefined

function classify(node: DOMNode): GroupKind {
  const tag = tagNameOf(node)
  if (!tag) return 'passthrough'
  if (FIELD_TAGS.has(tag)) return 'fields'
  if (FIELD_NOTE_TAGS.has(tag)) return 'fieldnotes'
  if (tag === 'bv-fact') return 'facts'
  if (tag === 'bv-rule') return 'rules'
  if (tag === 'bv-pattern') return 'patterns'
  return 'passthrough'
}

const isWhitespaceText = (node: DOMNode): boolean =>
  node.type === 'text' && 'data' in node && typeof node.data === 'string' && node.data.trim() === ''

/**
 * Partition a list of sibling DOM nodes into runs that should render as a
 * single grouped surface (facts table, rules list, patterns list, fields card).
 * Whitespace text nodes are folded into the active run so formatting in the
 * source HTML does not split groups.
 */
export function groupSiblings(children: DOMNode[]): NodeGroup[] {
  const groups: NodeGroup[] = []
  let active: NodeGroup | undefined

  for (const node of children) {
    if (isWhitespaceText(node)) {
      if (active) active.nodes.push(node)
      continue
    }

    const kind = classify(node)
    if (kind !== 'passthrough' && active && active.kind === kind) {
      active.nodes.push(node)
      continue
    }

    active = {kind, nodes: [node]}
    groups.push(active)
  }

  return groups
}
