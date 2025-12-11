import {expect} from 'chai'

import type {ContextFileContent} from '../../../../src/core/interfaces/i-context-file-reader.js'

import {mapToPushContexts} from '../../../../src/infra/cogit/context-tree-to-push-context-mapper.js'

describe('mapToPushContexts', () => {
  describe('mapping added files', () => {
    it('should map added files to push contexts with operation "add"', () => {
      const addedFiles: ContextFileContent[] = [
        {
          content: 'File content here',
          path: 'structure/context.md',
          title: 'Structure Context',
        },
      ]

      const result = mapToPushContexts({addedFiles, deletedPaths: [], modifiedFiles: []})

      expect(result).to.have.lengthOf(1)
      expect(result[0].operation).to.equal('add')
    })

    it('should set correct path, title, and content from file content', () => {
      const addedFiles: ContextFileContent[] = [
        {
          content: '# My Title\n\nSome content here',
          path: 'design/patterns/context.md',
          title: 'My Title',
        },
      ]

      const result = mapToPushContexts({addedFiles, deletedPaths: [], modifiedFiles: []})

      expect(result[0].path).to.equal('design/patterns/context.md')
      expect(result[0].title).to.equal('My Title')
      expect(result[0].content).to.equal('# My Title\n\nSome content here')
    })

    it('should set empty tags array', () => {
      const addedFiles: ContextFileContent[] = [
        {
          content: 'Some content',
          path: 'test/context.md',
          title: 'Test',
        },
      ]

      const result = mapToPushContexts({addedFiles, deletedPaths: [], modifiedFiles: []})

      expect(result[0].tags).to.deep.equal([])
    })
  })

  describe('edge cases', () => {
    it('should return empty array when all inputs are empty', () => {
      const result = mapToPushContexts({addedFiles: [], deletedPaths: [], modifiedFiles: []})

      expect(result).to.deep.equal([])
    })

    it('should preserve order of added files', () => {
      const addedFiles: ContextFileContent[] = [
        {content: 'First', path: 'first/context.md', title: 'First'},
        {content: 'Second', path: 'second/context.md', title: 'Second'},
        {content: 'Third', path: 'third/context.md', title: 'Third'},
      ]

      const result = mapToPushContexts({addedFiles, deletedPaths: [], modifiedFiles: []})

      expect(result).to.have.lengthOf(3)
      expect(result[0].path).to.equal('first/context.md')
      expect(result[1].path).to.equal('second/context.md')
      expect(result[2].path).to.equal('third/context.md')
    })
  })

  describe('multiple files', () => {
    it('should map all added files correctly', () => {
      const addedFiles: ContextFileContent[] = [
        {content: 'Content A', path: 'a/context.md', title: 'Title A'},
        {content: 'Content B', path: 'b/context.md', title: 'Title B'},
      ]

      const result = mapToPushContexts({addedFiles, deletedPaths: [], modifiedFiles: []})

      expect(result).to.have.lengthOf(2)

      expect(result[0].content).to.equal('Content A')
      expect(result[0].path).to.equal('a/context.md')
      expect(result[0].title).to.equal('Title A')
      expect(result[0].operation).to.equal('add')
      expect(result[0].tags).to.deep.equal([])

      expect(result[1].content).to.equal('Content B')
      expect(result[1].path).to.equal('b/context.md')
      expect(result[1].title).to.equal('Title B')
      expect(result[1].operation).to.equal('add')
      expect(result[1].tags).to.deep.equal([])
    })
  })

  describe('mapping modified files', () => {
    it('should map modified files to push contexts with operation "edit"', () => {
      const modifiedFiles: ContextFileContent[] = [
        {
          content: 'Updated content',
          path: 'structure/context.md',
          title: 'Updated Title',
        },
      ]

      const result = mapToPushContexts({addedFiles: [], deletedPaths: [], modifiedFiles})

      expect(result).to.have.lengthOf(1)
      expect(result[0].operation).to.equal('edit')
      expect(result[0].path).to.equal('structure/context.md')
      expect(result[0].title).to.equal('Updated Title')
      expect(result[0].content).to.equal('Updated content')
      expect(result[0].tags).to.deep.equal([])
    })

    it('should map multiple modified files correctly', () => {
      const modifiedFiles: ContextFileContent[] = [
        {content: 'Updated A', path: 'a/context.md', title: 'Title A'},
        {content: 'Updated B', path: 'b/context.md', title: 'Title B'},
      ]

      const result = mapToPushContexts({addedFiles: [], deletedPaths: [], modifiedFiles})

      expect(result).to.have.lengthOf(2)
      expect(result[0].operation).to.equal('edit')
      expect(result[1].operation).to.equal('edit')
    })
  })

  describe('mixing added and modified files', () => {
    it('should process both added and modified files', () => {
      const addedFiles: ContextFileContent[] = [
        {content: 'New content', path: 'new/context.md', title: 'New File'},
      ]
      const modifiedFiles: ContextFileContent[] = [
        {content: 'Updated content', path: 'existing/context.md', title: 'Updated File'},
      ]

      const result = mapToPushContexts({addedFiles, deletedPaths: [], modifiedFiles})

      expect(result).to.have.lengthOf(2)
    })

    it('should place added files before modified files', () => {
      const addedFiles: ContextFileContent[] = [
        {content: 'New', path: 'new/context.md', title: 'New'},
      ]
      const modifiedFiles: ContextFileContent[] = [
        {content: 'Updated', path: 'existing/context.md', title: 'Updated'},
      ]

      const result = mapToPushContexts({addedFiles, deletedPaths: [], modifiedFiles})

      expect(result[0].operation).to.equal('add')
      expect(result[0].path).to.equal('new/context.md')
      expect(result[1].operation).to.equal('edit')
      expect(result[1].path).to.equal('existing/context.md')
    })

    it('should handle multiple added and modified files', () => {
      const addedFiles: ContextFileContent[] = [
        {content: 'New 1', path: 'new1/context.md', title: 'New 1'},
        {content: 'New 2', path: 'new2/context.md', title: 'New 2'},
      ]
      const modifiedFiles: ContextFileContent[] = [
        {content: 'Updated 1', path: 'existing1/context.md', title: 'Updated 1'},
        {content: 'Updated 2', path: 'existing2/context.md', title: 'Updated 2'},
      ]

      const result = mapToPushContexts({addedFiles, deletedPaths: [], modifiedFiles})

      expect(result).to.have.lengthOf(4)
      expect(result[0].operation).to.equal('add')
      expect(result[1].operation).to.equal('add')
      expect(result[2].operation).to.equal('edit')
      expect(result[3].operation).to.equal('edit')
    })
  })

  describe('mapping deleted files', () => {
    it('should map deleted paths to push contexts with operation "delete"', () => {
      const deletedPaths = ['obsolete/context.md']

      const result = mapToPushContexts({addedFiles: [], deletedPaths, modifiedFiles: []})

      expect(result).to.have.lengthOf(1)
      expect(result[0].operation).to.equal('delete')
    })

    it('should set correct path for deleted files', () => {
      const deletedPaths = ['structure/old/context.md']

      const result = mapToPushContexts({addedFiles: [], deletedPaths, modifiedFiles: []})

      expect(result[0].path).to.equal('structure/old/context.md')
    })

    it('should set empty content and title for delete operation', () => {
      const deletedPaths = ['test/context.md']

      const result = mapToPushContexts({addedFiles: [], deletedPaths, modifiedFiles: []})

      expect(result[0].content).to.equal('')
      expect(result[0].title).to.equal('')
      expect(result[0].tags).to.deep.equal([])
    })

    it('should map multiple deleted paths correctly', () => {
      const deletedPaths = ['a/context.md', 'b/context.md', 'c/context.md']

      const result = mapToPushContexts({addedFiles: [], deletedPaths, modifiedFiles: []})

      expect(result).to.have.lengthOf(3)
      expect(result[0].operation).to.equal('delete')
      expect(result[0].path).to.equal('a/context.md')
      expect(result[1].operation).to.equal('delete')
      expect(result[1].path).to.equal('b/context.md')
      expect(result[2].operation).to.equal('delete')
      expect(result[2].path).to.equal('c/context.md')
    })
  })

  describe('mixing added, modified, and deleted files', () => {
    it('should process all three operation types', () => {
      const addedFiles: ContextFileContent[] = [
        {content: 'New content', path: 'new/context.md', title: 'New File'},
      ]
      const modifiedFiles: ContextFileContent[] = [
        {content: 'Updated content', path: 'existing/context.md', title: 'Updated File'},
      ]
      const deletedPaths = ['obsolete/context.md']

      const result = mapToPushContexts({addedFiles, deletedPaths, modifiedFiles})

      expect(result).to.have.lengthOf(3)
    })

    it('should place operations in order: added, edited, deleted', () => {
      const addedFiles: ContextFileContent[] = [
        {content: 'New', path: 'new/context.md', title: 'New'},
      ]
      const modifiedFiles: ContextFileContent[] = [
        {content: 'Updated', path: 'existing/context.md', title: 'Updated'},
      ]
      const deletedPaths = ['obsolete/context.md']

      const result = mapToPushContexts({addedFiles, deletedPaths, modifiedFiles})

      expect(result[0].operation).to.equal('add')
      expect(result[0].path).to.equal('new/context.md')
      expect(result[1].operation).to.equal('edit')
      expect(result[1].path).to.equal('existing/context.md')
      expect(result[2].operation).to.equal('delete')
      expect(result[2].path).to.equal('obsolete/context.md')
    })

    it('should handle multiple files of each operation type', () => {
      const addedFiles: ContextFileContent[] = [
        {content: 'New 1', path: 'new1/context.md', title: 'New 1'},
        {content: 'New 2', path: 'new2/context.md', title: 'New 2'},
      ]
      const modifiedFiles: ContextFileContent[] = [
        {content: 'Updated 1', path: 'existing1/context.md', title: 'Updated 1'},
      ]
      const deletedPaths = ['obsolete1/context.md', 'obsolete2/context.md']

      const result = mapToPushContexts({addedFiles, deletedPaths, modifiedFiles})

      expect(result).to.have.lengthOf(5)
      expect(result[0].operation).to.equal('add')
      expect(result[1].operation).to.equal('add')
      expect(result[2].operation).to.equal('edit')
      expect(result[3].operation).to.equal('delete')
      expect(result[4].operation).to.equal('delete')
    })
  })
})
