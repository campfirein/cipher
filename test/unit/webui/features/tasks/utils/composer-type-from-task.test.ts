import {expect} from 'chai'

import {composerTypeFromTask} from '../../../../../../src/webui/features/tasks/utils/composer-type-from-task.js'

describe('composerTypeFromTask', () => {
  it('maps query and search to query', () => {
    expect(composerTypeFromTask('query')).to.equal('query')
    expect(composerTypeFromTask('search')).to.equal('query')
  })

  it('maps curate and curate-folder to curate', () => {
    expect(composerTypeFromTask('curate')).to.equal('curate')
    expect(composerTypeFromTask('curate-folder')).to.equal('curate')
  })

  it('falls back to curate for unknown types so the composer still opens', () => {
    expect(composerTypeFromTask('something-new')).to.equal('curate')
    expect(composerTypeFromTask('')).to.equal('curate')
  })
})
