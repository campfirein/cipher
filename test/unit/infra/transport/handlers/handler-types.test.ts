import {expect} from 'chai'
import {restore, stub} from 'sinon'

import {resolveRequiredProjectPath} from '../../../../../src/server/infra/transport/handlers/handler-types.js'

describe('resolveRequiredProjectPath', () => {
  afterEach(() => {
    restore()
  })

  it('should return project path when resolver returns a value', () => {
    const resolver = stub().returns('/test/project')

    const result = resolveRequiredProjectPath(resolver, 'client-1')

    expect(result).to.equal('/test/project')
    expect(resolver.calledOnce).to.be.true
    expect(resolver.calledWith('client-1')).to.be.true
  })

  it('should throw when resolver returns undefined', () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    const resolver = stub().returns(undefined)

    expect(() => resolveRequiredProjectPath(resolver, 'client-42')).to.throw(
      "No project path found for client 'client-42'",
    )
  })

  it('should include client ID in error message', () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    const resolver = stub().returns(undefined)

    expect(() => resolveRequiredProjectPath(resolver, 'mcp-global-123')).to.throw('mcp-global-123')
  })

  it('should pass clientId to resolver', () => {
    const resolver = stub().returns('/some/path')

    resolveRequiredProjectPath(resolver, 'test-client')

    expect(resolver.calledWith('test-client')).to.be.true
  })
})
