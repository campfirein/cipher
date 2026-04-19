import {expect} from 'chai'

import {ConsolidateResponseSchema} from '../../../../src/server/infra/dream/dream-response-schemas.js'
import {parseDreamResponse} from '../../../../src/server/infra/dream/parse-dream-response.js'

describe('parseDreamResponse', () => {
  const schema = ConsolidateResponseSchema

  it('should parse JSON in a code fence', () => {
    const response = '```json\n{"actions":[]}\n```'
    const result = parseDreamResponse(response, schema)
    expect(result).to.deep.equal({actions: []})
  })

  it('should parse raw JSON embedded in text', () => {
    const response = 'Here\'s my analysis: {"actions":[{"type":"MERGE","files":["a.md"],"reason":"dup"}]} Hope that helps'
    const result = parseDreamResponse(response, schema)
    expect(result).to.not.be.null
    expect(result?.actions).to.have.lengthOf(1)
  })

  it('should prefer code fence over raw JSON', () => {
    const response = '```json\n{"actions":[]}\n``` Some extra text with {"actions":[{"type":"SKIP","files":["x.md"],"reason":"r"}]}'
    const result = parseDreamResponse(response, schema)
    expect(result).to.deep.equal({actions: []})
  })

  it('should parse bare JSON object', () => {
    const response = '{"actions": [{"type":"MERGE","files":["a.md"],"reason":"dup"}]}'
    const result = parseDreamResponse(response, schema)
    expect(result).to.not.be.null
    expect(result?.actions[0].type).to.equal('MERGE')
  })

  it('should return null for no JSON', () => {
    const result = parseDreamResponse('No JSON here at all', schema)
    expect(result).to.be.null
  })

  it('should return null for valid JSON but wrong schema', () => {
    const result = parseDreamResponse('{"not_actions": true}', schema)
    expect(result).to.be.null
  })

  it('should return null for malformed JSON', () => {
    const result = parseDreamResponse('{malformed json', schema)
    expect(result).to.be.null
  })

  it('should return null for empty string', () => {
    const result = parseDreamResponse('', schema)
    expect(result).to.be.null
  })

  it('should use first code fence when multiple present', () => {
    const response = '```json\n{"actions":[]}\n```\nand\n```json\n{"actions":[{"type":"SKIP","files":["x.md"],"reason":"r"}]}\n```'
    const result = parseDreamResponse(response, schema)
    expect(result).to.deep.equal({actions: []})
  })
})
