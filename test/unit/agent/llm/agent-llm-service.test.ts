import {expect} from 'chai'

import {buildDateTimePrefix} from '../../../../src/agent/infra/llm/agent-llm-service.js'

describe('buildDateTimePrefix', () => {
  it('renders the supplied date as an ISO-8601 dateTime block followed by a blank line', () => {
    const fixed = new Date('2026-05-01T10:30:00.000Z')
    const result = buildDateTimePrefix(fixed)

    expect(result).to.equal('<dateTime>Current date and time: 2026-05-01T10:30:00.000Z</dateTime>\n\n')
  })

  it('uses the current time when no date is supplied', () => {
    const before = Date.now()
    const result = buildDateTimePrefix()
    const after = Date.now()

    const match = /<dateTime>Current date and time: (\S+)<\/dateTime>\n\n$/.exec(result)
    expect(match).to.not.equal(null)

    const rendered = match === null ? 0 : Date.parse(match[1])
    expect(rendered).to.be.at.least(before)
    expect(rendered).to.be.at.most(after)
  })

  it('terminates with a double-newline so the prefix can be concatenated directly to a text body', () => {
    const result = buildDateTimePrefix(new Date('2026-01-01T00:00:00.000Z'))
    const composed = `${result}body`

    expect(composed).to.equal('<dateTime>Current date and time: 2026-01-01T00:00:00.000Z</dateTime>\n\nbody')
  })
})
