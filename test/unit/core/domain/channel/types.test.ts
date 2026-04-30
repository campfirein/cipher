import {expect} from 'chai'

import {
  AgentNotAvailableError,
  AgentNotInstalledError,
  AgentNotInvitableError,
  AgentUnknownError,
  ChannelAlreadyExistsError,
  ChannelError,
  ChannelNotFoundError,
  ChannelTreeNotFoundError,
  InvalidTransitionError,
  MentionParseError,
} from '../../../../../src/server/core/domain/channel/errors.js'
import {
  AcpLaunchSpec,
  ChannelMember,
  TurnTransitionEvent,
} from '../../../../../src/server/core/domain/channel/types.js'

describe('channel domain types', () => {
  it('validates ACP launch specs by discriminator', () => {
    expect(AcpLaunchSpec.parse({args: ['acp'], command: 'opencode', kind: 'stdio'})).to.deep.equal({
      args: ['acp'],
      command: 'opencode',
      kind: 'stdio',
    })
    expect(AcpLaunchSpec.parse({host: '127.0.0.1', kind: 'tcp', port: 9123})).to.deep.equal({
      host: '127.0.0.1',
      kind: 'tcp',
      port: 9123,
    })
    expect(AcpLaunchSpec.parse({kind: 'mock', mockId: 'echo'})).to.deep.equal({kind: 'mock', mockId: 'echo'})
    expect(AcpLaunchSpec.safeParse({host: '127.0.0.1', kind: 'tcp', port: -1}).success).to.equal(false)
  })

  it('validates channel member health fields for compatibility reporting', () => {
    const parsed = ChannelMember.parse({
      acpVersion: '0.21.0',
      agentId: 'codex',
      cliVersion: '1.0.3',
      joinedAt: '2026-04-30T00:00:00.000Z',
      status: 'acp_incompatible',
    })

    expect(parsed.status).to.equal('acp_incompatible')
    expect(parsed.acpVersion).to.equal('0.21.0')
    expect(parsed.cliVersion).to.equal('1.0.3')
  })

  it('validates turn transition event payloads', () => {
    expect(TurnTransitionEvent.parse({type: 'route'})).to.deep.equal({type: 'route'})
    expect(TurnTransitionEvent.parse({permissionRequestId: 'perm-1', type: 'await_permission'})).to.deep.equal({
      permissionRequestId: 'perm-1',
      type: 'await_permission',
    })
    expect(TurnTransitionEvent.parse({decision: 'always', type: 'permission_decision'})).to.deep.equal({
      decision: 'always',
      type: 'permission_decision',
    })
    expect(TurnTransitionEvent.safeParse({decision: 'maybe', type: 'permission_decision'}).success).to.equal(false)
  })

  it('exposes typed channel errors', () => {
    const errors = [
      new ChannelNotFoundError('missing'),
      new ChannelTreeNotFoundError('/tmp/project', '/tmp/project'),
      new ChannelAlreadyExistsError('existing'),
      new InvalidTransitionError('submitted', 'complete'),
      new AgentNotAvailableError('mock-a'),
      new AgentUnknownError('missing-agent'),
      new AgentNotInstalledError('codex', 'brv channel doctor --install codex'),
      new AgentNotInvitableError('claude-desktop'),
      new MentionParseError('@missing do work'),
    ]

    for (const error of errors) {
      expect(error).to.be.instanceOf(ChannelError)
      expect(error.code).to.be.a('string').and.not.equal('')
      expect(error.message).to.be.a('string').and.not.equal('')
    }

    const treeError = errors[1]
    expect(treeError).to.be.instanceOf(ChannelTreeNotFoundError)
    if (treeError instanceof ChannelTreeNotFoundError) {
      expect(treeError.suggestions).to.deep.equal([
        {action: 'brv init', scope: 'project'},
        {action: 'brv channel new <id> --global', scope: 'global'},
        {action: 'brv channel new <id> --isolated', scope: 'isolated'},
      ])
    }
  })
})
