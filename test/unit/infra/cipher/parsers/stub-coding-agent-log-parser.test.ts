import {expect} from 'chai'

import {StubCodingAgentLogParser} from '../../../../../src/infra/cipher/parsers/stub-coding-agent-log-parser.js'

describe('StubCodingAgentLogParser', () => {
  let parser: StubCodingAgentLogParser

  beforeEach(() => {
    parser = new StubCodingAgentLogParser()
  })

  describe('parseLogFile', () => {
    it('should return array of CleanSession with mock data', async () => {
      const result = await parser.parseLogFile()

      expect(result).to.be.an('array')
      expect(result).to.have.lengthOf(1)
    })

    it('should return CleanSession with correct structure', async () => {
      const result = await parser.parseLogFile()

      const session = result[0]
      expect(session).to.have.property('id')
      expect(session).to.have.property('messages')
      expect(session).to.have.property('timestamp')
      expect(session).to.have.property('title')
      expect(session).to.have.property('type')
      expect(session).to.have.property('workspacePaths')
      expect(session).to.have.property('metadata')
    })

    it('should include source in metadata', async () => {
      const result = await parser.parseLogFile()

      expect(result[0].metadata).to.deep.include({
        source: 'stub-parser',
      })
    })

    it('should have Claude as session type', async () => {
      const result = await parser.parseLogFile()
      expect(result[0].type).to.equal('Claude')
    })

    it('should have valid timestamp', async () => {
      const before = Date.now()
      const result = await parser.parseLogFile()
      const after = Date.now()

      expect(result[0].timestamp).to.be.at.least(before)
      expect(result[0].timestamp).to.be.at.most(after)
    })

    it('should return frozen array', async () => {
      const result = await parser.parseLogFile()
      expect(Object.isFrozen(result)).to.be.true
    })
  })
})
