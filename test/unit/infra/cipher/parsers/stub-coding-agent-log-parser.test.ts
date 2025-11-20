import {expect} from 'chai'

import {StubCodingAgentLogParser} from '../../../../../src/infra/cipher/parsers/stub-coding-agent-log-parser.js'

describe('StubCodingAgentLogParser', () => {
  let parser: StubCodingAgentLogParser

  beforeEach(() => {
    parser = new StubCodingAgentLogParser()
  })

  describe('isValidLogFile', () => {
    it('should return true for .log files', () => {
      expect(parser.isValidLogFile('/path/to/file.log')).to.be.true
    })

    it('should return true for .json files', () => {
      expect(parser.isValidLogFile('/path/to/file.json')).to.be.true
    })

    it('should return false for .txt files', () => {
      expect(parser.isValidLogFile('/path/to/file.txt')).to.be.false
    })

    it('should return false for files without extension', () => {
      expect(parser.isValidLogFile('/path/to/file')).to.be.false
    })

    it('should return false for .md files', () => {
      expect(parser.isValidLogFile('/path/to/README.md')).to.be.false
    })

    it('should handle paths with multiple dots correctly', () => {
      expect(parser.isValidLogFile('/path/to/file.test.log')).to.be.true
      expect(parser.isValidLogFile('/path/to/file.test.txt')).to.be.false
    })
  })

  describe('parseLogFile', () => {
    it('should return array of ParsedInteraction with mock data', async () => {
      const filePath = '/path/to/test.log'
      const result = await parser.parseLogFile(filePath)

      expect(result).to.be.an('array')
      expect(result).to.have.lengthOf(1)
    })

    it('should return ParsedInteraction with correct structure', async () => {
      const filePath = '/path/to/test.json'
      const result = await parser.parseLogFile(filePath)

      const interaction = result[0]
      expect(interaction).to.have.property('timestamp')
      expect(interaction).to.have.property('agentType')
      expect(interaction).to.have.property('userMessage')
      expect(interaction).to.have.property('agentResponse')
      expect(interaction).to.have.property('metadata')
    })

    it('should include file path in metadata', async () => {
      const filePath = '/path/to/test.log'
      const result = await parser.parseLogFile(filePath)

      expect(result[0].metadata).to.deep.include({
        originalFile: filePath,
        source: 'stub-parser',
      })
    })

    it('should have stub agentType', async () => {
      const result = await parser.parseLogFile('/test.log')
      expect(result[0].agentType).to.equal('stub')
    })

    it('should have valid timestamp', async () => {
      const before = Date.now()
      const result = await parser.parseLogFile('/test.log')
      const after = Date.now()

      expect(result[0].timestamp).to.be.at.least(before)
      expect(result[0].timestamp).to.be.at.most(after)
    })

    it('should throw error for invalid file paths', async () => {
      try {
        await parser.parseLogFile('/invalid/file.txt')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('not a valid log file')
      }
    })

    it('should throw error for empty file path', async () => {
      try {
        await parser.parseLogFile('')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
      }
    })
  })
})
