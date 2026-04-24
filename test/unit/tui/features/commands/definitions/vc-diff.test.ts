/**
 * TUI `/vc diff` slash-command wiring tests.
 *
 * Verifies that the slash-command definition correctly:
 *  - parses REPL-style arg strings through `parseMode`
 *  - propagates the parsed mode into the VcDiffFlow render
 *  - rejects invalid arg combinations (three-dot, --staged + ref) at command-parse time
 *
 * Does NOT render Ink components (that's an integration concern); asserts on the action
 * output and react element props, which is where the regression risk lives.
 */

import {expect} from 'chai'
import React from 'react'

import {vcDiffSubCommand} from '../../../../../../src/tui/features/commands/definitions/vc-diff.js'

function runAction(argString: string) {
  // SlashCommand.action signature: (context, args) => Promise<{render}>
  return vcDiffSubCommand.action!({} as never, argString)
}

async function renderPropsFor(argString: string) {
  const result = await runAction(argString)
  if (!result || !('render' in result)) throw new Error('expected render return')
  const element = result.render({
    onCancel() {},
    onComplete() {},
  })
  return (element as React.ReactElement<{mode: unknown}>).props
}

describe('/vc diff slash command', () => {
  it('has the expected name + description', () => {
    expect(vcDiffSubCommand.name).to.equal('diff')
    expect(vcDiffSubCommand.description).to.include('changes between commits')
  })

  it('exposes a `ref` positional arg and a `--staged` flag in its help metadata', () => {
    expect(vcDiffSubCommand.args).to.deep.include({
      description: 'commit, branch, or <ref1>..<ref2> range',
      name: 'ref',
    })
    const flagNames = (vcDiffSubCommand.flags ?? []).map((f) => f.name)
    expect(flagNames).to.include('staged')
  })

  describe('arg parsing → mode propagation', () => {
    it('no args → mode=unstaged', async () => {
      const props = await renderPropsFor('')
      expect(props.mode).to.deep.equal({kind: 'unstaged'})
    })

    it('--staged → mode=staged', async () => {
      const props = await renderPropsFor('--staged')
      expect(props.mode).to.deep.equal({kind: 'staged'})
    })

    it('<ref> → mode=ref-vs-worktree', async () => {
      const props = await renderPropsFor('main')
      expect(props.mode).to.deep.equal({kind: 'ref-vs-worktree', ref: 'main'})
    })

    it('<ref>..<ref> → mode=range', async () => {
      const props = await renderPropsFor('HEAD~3..HEAD')
      expect(props.mode).to.deep.equal({from: 'HEAD~3', kind: 'range', to: 'HEAD'})
    })

    it('three-dot syntax rejected with clear error', async () => {
      try {
        await runAction('main...feature')
        expect.fail('expected throw')
      } catch (error) {
        expect((error as Error).message).to.match(/three-dot/)
      }
    })

    it('--staged combined with ref rejected', async () => {
      try {
        await runAction('--staged main')
        expect.fail('expected throw')
      } catch (error) {
        expect((error as Error).message).to.match(/--staged cannot be combined/)
      }
    })
  })

  it('is registered under the parent /vc slash command', async () => {
    const {vcCommand} = await import('../../../../../../src/tui/features/commands/definitions/vc.js')
    const names = (vcCommand.subCommands ?? []).map((c) => c.name)
    expect(names).to.include('diff')
  })
})
