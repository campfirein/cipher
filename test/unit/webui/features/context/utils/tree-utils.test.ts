import {expect} from 'chai'

import type {ContextNode} from '../../../../../../src/webui/features/context/types'

import {
  findNodeByPath,
  flattenTree,
  getExpandedPathsForPath,
  isFilePath,
} from '../../../../../../src/webui/features/context/utils/tree-utils'

describe('tree-utils', () => {
  describe('isFilePath', () => {
    it('should return true for .md files', () => {
      expect(isFilePath('docs/readme.md')).to.be.true
      expect(isFilePath('auth.md')).to.be.true
    })

    it('should return false for folder paths', () => {
      expect(isFilePath('docs')).to.be.false
      expect(isFilePath('docs/api')).to.be.false
    })

    it('should return false for empty string', () => {
      expect(isFilePath('')).to.be.false
    })
  })

  describe('getExpandedPathsForPath', () => {
    it('should return all parent folder paths for a file', () => {
      const result = getExpandedPathsForPath('docs/api/endpoint.md')
      expect(result).to.deep.equal(new Set(['docs', 'docs/api']))
    })

    it('should include the folder itself for a folder path', () => {
      const result = getExpandedPathsForPath('docs/api')
      expect(result).to.deep.equal(new Set(['docs', 'docs/api']))
    })

    it('should return single entry for top-level folder', () => {
      const result = getExpandedPathsForPath('docs')
      expect(result).to.deep.equal(new Set(['docs']))
    })

    it('should return empty set for empty string', () => {
      const result = getExpandedPathsForPath('')
      expect(result).to.deep.equal(new Set())
    })

    it('should not include the file itself', () => {
      const result = getExpandedPathsForPath('auth.md')
      expect(result).to.deep.equal(new Set())
    })
  })

  describe('findNodeByPath', () => {
    const tree: ContextNode[] = [
      {
        children: [
          {name: 'auth.md', path: 'architecture/auth.md', type: 'blob'},
          {
            children: [{name: 'deep.md', path: 'architecture/api/deep.md', type: 'blob'}],
            name: 'api',
            path: 'architecture/api',
            type: 'tree',
          },
        ],
        name: 'architecture',
        path: 'architecture',
        type: 'tree',
      },
      {name: 'readme.md', path: 'readme.md', type: 'blob'},
    ]

    it('should find a top-level node', () => {
      const node = findNodeByPath(tree, 'readme.md')
      expect(node).to.exist
      expect(node!.name).to.equal('readme.md')
    })

    it('should find a nested file', () => {
      const node = findNodeByPath(tree, 'architecture/auth.md')
      expect(node).to.exist
      expect(node!.name).to.equal('auth.md')
    })

    it('should find a deeply nested file', () => {
      const node = findNodeByPath(tree, 'architecture/api/deep.md')
      expect(node).to.exist
      expect(node!.name).to.equal('deep.md')
    })

    it('should find a folder node', () => {
      const node = findNodeByPath(tree, 'architecture')
      expect(node).to.exist
      expect(node!.type).to.equal('tree')
    })

    it('should return undefined for non-existent path', () => {
      const node = findNodeByPath(tree, 'nonexistent.md')
      expect(node).to.be.undefined
    })

    it('should return undefined for empty tree', () => {
      const node = findNodeByPath([], 'anything')
      expect(node).to.be.undefined
    })
  })

  describe('flattenTree', () => {
    // Pre-sorted as the server would return (folders first, then alphabetical)
    const tree: ContextNode[] = [
      {
        children: [
          {
            children: [{name: 'deep.md', path: 'architecture/api/deep.md', type: 'blob'}],
            name: 'api',
            path: 'architecture/api',
            type: 'tree',
          },
          {name: 'auth.md', path: 'architecture/auth.md', type: 'blob'},
        ],
        name: 'architecture',
        path: 'architecture',
        type: 'tree',
      },
      {name: 'readme.md', path: 'readme.md', type: 'blob'},
    ]

    it('should flatten only top-level when nothing is expanded', () => {
      const result = flattenTree(tree, new Set())
      expect(result).to.have.length(2)
      expect(result[0].node.name).to.equal('architecture')
      expect(result[0].depth).to.equal(0)
      expect(result[1].node.name).to.equal('readme.md')
      expect(result[1].depth).to.equal(0)
    })

    it('should include children of expanded folders', () => {
      const result = flattenTree(tree, new Set(['architecture']))
      expect(result).to.have.length(4)
      expect(result[0].node.name).to.equal('architecture')
      expect(result[0].depth).to.equal(0)
      // Pre-sorted: api (tree) before auth.md (blob)
      expect(result[1].node.name).to.equal('api')
      expect(result[1].depth).to.equal(1)
      expect(result[2].node.name).to.equal('auth.md')
      expect(result[2].depth).to.equal(1)
      expect(result[3].node.name).to.equal('readme.md')
      expect(result[3].depth).to.equal(0)
    })

    it('should recursively expand nested folders', () => {
      const result = flattenTree(tree, new Set(['architecture', 'architecture/api']))
      expect(result).to.have.length(5)
      expect(result[0].node.name).to.equal('architecture')
      expect(result[1].node.name).to.equal('api')
      expect(result[1].depth).to.equal(1)
      expect(result[2].node.name).to.equal('deep.md')
      expect(result[2].depth).to.equal(2)
      expect(result[3].node.name).to.equal('auth.md')
      expect(result[4].node.name).to.equal('readme.md')
    })

    it('should return empty array for empty tree', () => {
      const result = flattenTree([], new Set())
      expect(result).to.deep.equal([])
    })
  })
})
