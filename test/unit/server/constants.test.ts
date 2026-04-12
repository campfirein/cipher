import {expect} from 'chai'

import {CONTEXT_TREE_GITIGNORE} from '../../../src/server/constants.js'

describe('CONTEXT_TREE_GITIGNORE', () => {
  it('should exclude adaptive-generated abstract files', () => {
    expect(CONTEXT_TREE_GITIGNORE).to.include('*.abstract.md')
  })

  it('should exclude adaptive-generated overview files', () => {
    expect(CONTEXT_TREE_GITIGNORE).to.include('*.overview.md')
  })

  it('should still exclude legacy infrastructure files', () => {
    expect(CONTEXT_TREE_GITIGNORE).to.include('.gitignore')
    expect(CONTEXT_TREE_GITIGNORE).to.include('.snapshot.json')
    expect(CONTEXT_TREE_GITIGNORE).to.include('_manifest.json')
    expect(CONTEXT_TREE_GITIGNORE).to.include('_index.md')
  })
})
