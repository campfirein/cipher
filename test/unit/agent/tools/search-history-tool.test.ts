import {expect} from 'chai'

import {createSearchHistoryTool} from '../../../../src/agent/infra/tools/implementations/search-history-tool.js'

describe('Search History Tool', () => {
  it('should throw error as it is not implemented', async () => {
    const tool = createSearchHistoryTool()

    try {
      await tool.execute({
        mode: 'messages',
        query: 'test',
      })
      expect.fail('Should have thrown an error')
    } catch (error: unknown) {
      expect(error instanceof Error).to.be.true
      if (error instanceof Error) {
        expect(error.message).to.include('not yet implemented')
      }
    }
  })

  it('should have correct input schema', () => {
    const tool = createSearchHistoryTool()
    expect(tool.inputSchema).to.exist
    expect(tool.id).to.equal('search_history')
  })
})
