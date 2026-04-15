import {expect} from 'chai'

import {CONTEXT_TREE_GITIGNORE_PATTERNS} from '../../../src/server/constants.js'

describe('CONTEXT_TREE_GITIGNORE_PATTERNS', () => {
  it('should exclude adaptive-generated abstract files', () => {
    expect(CONTEXT_TREE_GITIGNORE_PATTERNS).to.include('*.abstract.md')
  })

  it('should exclude adaptive-generated overview files', () => {
    expect(CONTEXT_TREE_GITIGNORE_PATTERNS).to.include('*.overview.md')
  })

  it('should still exclude legacy infrastructure files', () => {
    expect(CONTEXT_TREE_GITIGNORE_PATTERNS).to.include('.gitignore')
    expect(CONTEXT_TREE_GITIGNORE_PATTERNS).to.include('.snapshot.json')
    expect(CONTEXT_TREE_GITIGNORE_PATTERNS).to.include('_manifest.json')
    expect(CONTEXT_TREE_GITIGNORE_PATTERNS).to.include('_index.md')
  })
})
