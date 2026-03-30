import {expect} from 'chai'

import {readSectionLinesFromContent} from '../../../../src/server/infra/context-tree/experience-section-parser.js'

describe('readSectionLinesFromContent()', () => {
  it('reads bullet lines when the heading is at the start of the file', () => {
    const content = ['## Facts', '', '- First lesson', '- Second lesson'].join('\n')

    expect(readSectionLinesFromContent(content, 'Facts')).to.deep.equal([
      'First lesson',
      'Second lesson',
    ])
  })

  it('reads bullet lines from later sections without including following headings', () => {
    const content = ['', '## Facts', '', '- First lesson', '', '## Hints', '', '- Hint text'].join('\n')

    expect(readSectionLinesFromContent(content, 'Facts')).to.deep.equal(['First lesson'])
  })
})
