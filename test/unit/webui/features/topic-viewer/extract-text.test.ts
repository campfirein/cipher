import {expect} from 'chai'
import {type DOMNode, htmlToDOM} from 'html-react-parser'

import {extractText} from '../../../../../packages/byterover-packages/ui/src/components/topic-viewer/dom-utils.js'

const findFirstElement = (nodes: DOMNode[], tagName: string): DOMNode | undefined => {
  for (const node of nodes) {
    if (node.type === 'tag' && 'tagName' in node && node.tagName === tagName) return node
    if ('children' in node && Array.isArray(node.children)) {
      const found = findFirstElement(node.children as DOMNode[], tagName)
      if (found) return found
    }
  }

  return undefined
}

describe('extractText', () => {
  it('returns text content from a plain text-only node', () => {
    const dom = htmlToDOM('<bv-diagram type="mermaid">graph TD\nA --&gt; B</bv-diagram>') as DOMNode[]
    const diagram = findFirstElement(dom, 'bv-diagram')

    expect(diagram).to.exist
    expect(extractText(diagram!).trim()).to.equal('graph TD\nA --> B')
  })

  it('recursively unwraps text from nested <pre><code> wrappers', () => {
    // Mirrors the real failure mode: LLM-authored topics wrap mermaid sources
    // in <pre><code> fences. childrenToString() would have returned '' here
    // because the children have been transformed into a CodeBlock element.
    const dom = htmlToDOM(
      '<bv-diagram type="mermaid"><pre><code>graph TD\nA --&gt; B\nB --&gt; C</code></pre></bv-diagram>',
    ) as DOMNode[]
    const diagram = findFirstElement(dom, 'bv-diagram')

    expect(diagram).to.exist
    expect(extractText(diagram!).trim()).to.equal('graph TD\nA --> B\nB --> C')
  })
})
