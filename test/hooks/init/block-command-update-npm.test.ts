import {expect} from 'chai'
import {restore, stub} from 'sinon'

import {handleBlockCommandUpdateNpm} from '../../../src/oclif/hooks/init/block-command-update-npm.js'

describe('block-command-update-npm hook', () => {
  let errorStub: ReturnType<typeof stub>

  beforeEach(() => {
    errorStub = stub()
  })

  afterEach(() => {
    restore()
  })

  it('should block brv update when installed via npm global', () => {
    handleBlockCommandUpdateNpm({
      commandId: 'update',
      errorFn: errorStub,
      isNpmGlobalInstalled: true,
    })

    expect(errorStub.calledOnce).to.be.true
    expect(errorStub.firstCall.args[0]).to.equal(
      'brv was installed via npm. Use `npm update -g byterover-cli` to update.',
    )
    expect(errorStub.firstCall.args[1]).to.deep.equal({exit: 1})
  })

  it('should not block brv update when not installed via npm global', () => {
    handleBlockCommandUpdateNpm({
      commandId: 'update',
      errorFn: errorStub,
      isNpmGlobalInstalled: false,
    })

    expect(errorStub.called).to.be.false
  })

  it('should not block non-update commands even when npm global', () => {
    handleBlockCommandUpdateNpm({
      commandId: 'status',
      errorFn: errorStub,
      isNpmGlobalInstalled: true,
    })

    expect(errorStub.called).to.be.false
  })

  it('should not block when commandId is undefined', () => {
    handleBlockCommandUpdateNpm({
      commandId: undefined,
      errorFn: errorStub,
      isNpmGlobalInstalled: true,
    })

    expect(errorStub.called).to.be.false
  })
})
