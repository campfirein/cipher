import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {restore, stub} from 'sinon'

import Dream from '../../src/oclif/commands/dream.js'

// `brv dream` (no subcommand) is now a topic root — see ENG-2884.
// The LLM-driven consolidate/synthesize/prune dispatch was removed;
// users run `brv dream {scan,finalize,undo,sessions,cancel}` instead.
// This file keeps a minimal smoke around the topic root so the command
// continues to load and prints the migration hint.

describe('Dream Command (topic root)', () => {
  let config: Config
  let loggedMessages: string[]

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []
  })

  afterEach(() => {
    restore()
  })

  it('prints the subcommand migration hint and exits 0', async () => {
    const command = new Dream([], config)
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })

    await command.run()

    expect(loggedMessages).to.have.lengthOf.at.least(1)
    expect(loggedMessages.join('\n')).to.include('brv dream')
    expect(loggedMessages.join('\n')).to.include('scan')
    expect(loggedMessages.join('\n')).to.include('finalize')
    expect(loggedMessages.join('\n')).to.include('undo')
  })
})
