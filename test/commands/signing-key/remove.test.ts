import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {restore, stub} from 'sinon'

import SigningKeyRemove from '../../../src/oclif/commands/signing-key/remove.js'

describe('signing-key remove --yes guard', () => {
  let config: Config

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  afterEach(() => {
    restore()
  })

  it('refuses without --yes and does not touch the network', async () => {
    const cmd = new SigningKeyRemove(['fake-id'], config)
    const errorStub = stub(cmd, 'error').throws(new Error('STOP'))

    let thrown: unknown
    try {
      await cmd.run()
    } catch (error) {
      thrown = error
    }

    expect(thrown).to.be.instanceOf(Error)
    expect(errorStub.calledOnce).to.be.true
    const [firstArg] = errorStub.firstCall.args as [string]
    expect(firstArg).to.match(/--yes/)
    expect(firstArg).to.match(/irreversible/i)
  })

  it('declares the --yes flag on the command', () => {
    expect(SigningKeyRemove.flags).to.have.property('yes')
  })
})
