import {expect} from 'chai'

import {statusFilterToServer} from '../../../../../../src/webui/features/tasks/utils/status-filter-to-server.js'

describe('statusFilterToServer', () => {
  it('returns undefined for all (no server filter)', () => {
    expect(statusFilterToServer('all')).to.equal(undefined)
  })

  it('maps cancelled, completed, failed to single-value arrays', () => {
    expect(statusFilterToServer('cancelled')).to.deep.equal(['cancelled'])
    expect(statusFilterToServer('completed')).to.deep.equal(['completed'])
    expect(statusFilterToServer('failed')).to.deep.equal(['error'])
  })

  it('expands running to created + started', () => {
    expect(statusFilterToServer('running')).to.deep.equal(['created', 'started'])
  })
})
