/**
 * TUI `/vc rm` slash-command wiring tests.
 *
 * Verifies that the slash-command definition correctly parses every shipped flag
 * combination and propagates the resulting `IVcRmRequest` into the `VcRmFlow` render.
 * Does NOT render Ink components — asserts on the action output and react element props.
 */

import {expect} from 'chai'
import React from 'react'

import type {IVcRmRequest} from '../../../../../../src/shared/transport/events/vc-events.js'

import {vcRmSubCommand} from '../../../../../../src/tui/features/commands/definitions/vc-rm.js'

function runAction(argString: string) {
  return vcRmSubCommand.action!({} as never, argString)
}

async function renderRequestFor(argString: string): Promise<IVcRmRequest> {
  const result = await runAction(argString)
  if (!result || !('render' in result)) throw new Error('expected render return')
  const element = result.render({
    onCancel() {},
    onComplete() {},
  })
  return (element as React.ReactElement<{request: IVcRmRequest}>).props.request
}

describe('/vc rm slash command', () => {
  it('has the expected name + description', () => {
    expect(vcRmSubCommand.name).to.equal('rm')
    expect(vcRmSubCommand.description).to.include('Remove')
  })

  it('exposes the shipped flag set in help metadata', () => {
    const flagNames = (vcRmSubCommand.flags ?? []).map((f) => f.name)
    expect(flagNames).to.include.members([
      'cached',
      'dry-run',
      'force',
      'ignore-unmatch',
      'pathspec-file-nul',
      'pathspec-from-file',
      'quiet',
      'recursive',
    ])
  })

  it('positional file paths flow into request.filePaths', async () => {
    const req = await renderRequestFor('a.md b.md')
    expect(req.filePaths).to.deep.equal(['a.md', 'b.md'])
  })

  it('--cached propagates as cached:true', async () => {
    const req = await renderRequestFor('--cached a.md')
    expect(req.cached).to.be.true
    expect(req.filePaths).to.deep.equal(['a.md'])
  })

  it('-r propagates as recursive:true', async () => {
    const req = await renderRequestFor('-r docs/')
    expect(req.recursive).to.be.true
    expect(req.filePaths).to.deep.equal(['docs/'])
  })

  it('-f propagates as force:true', async () => {
    const req = await renderRequestFor('-f a.md')
    expect(req.force).to.be.true
  })

  it('-n propagates as dryRun:true', async () => {
    const req = await renderRequestFor('-n a.md')
    expect(req.dryRun).to.be.true
  })

  it('-q propagates as quiet:true', async () => {
    const req = await renderRequestFor('-q a.md')
    expect(req.quiet).to.be.true
  })

  it('--ignore-unmatch propagates', async () => {
    const req = await renderRequestFor('--ignore-unmatch nope.md')
    expect(req.ignoreUnmatch).to.be.true
  })

  it('--pathspec-from-file propagates the string value', async () => {
    const req = await renderRequestFor('--pathspec-from-file paths.txt')
    expect(req.pathspecFromFile).to.equal('paths.txt')
  })

  it('--pathspec-file-nul flag propagates when paired with --pathspec-from-file', async () => {
    const req = await renderRequestFor('--pathspec-from-file paths.txt --pathspec-file-nul')
    expect(req.pathspecFileNul).to.be.true
    expect(req.pathspecFromFile).to.equal('paths.txt')
  })

  it('combines multiple flags with positional paths', async () => {
    const req = await renderRequestFor('-r --cached docs/ notes.md')
    expect(req).to.deep.include({
      cached: true,
      filePaths: ['docs/', 'notes.md'],
      recursive: true,
    })
  })
})
