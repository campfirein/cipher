import {expect} from 'chai'

import {buildRemoteSpaceUrl} from '../../../../../../src/webui/features/project/utils/build-remote-space-url'

describe('buildRemoteSpaceUrl', () => {
  it('returns the webApp URL for a linked team and space', () => {
    expect(
      buildRemoteSpaceUrl({spaceName: 'payments', teamName: 'acme', webAppUrl: 'https://app.byterover.dev'}),
    ).to.equal('https://app.byterover.dev/acme/payments')
  })

  it('strips a trailing slash from the base URL', () => {
    expect(
      buildRemoteSpaceUrl({spaceName: 'payments', teamName: 'acme', webAppUrl: 'https://app.byterover.dev/'}),
    ).to.equal('https://app.byterover.dev/acme/payments')
  })

  it('returns undefined when the base URL is missing', () => {
    expect(buildRemoteSpaceUrl({spaceName: 'payments', teamName: 'acme', webAppUrl: undefined})).to.equal(undefined)
    expect(buildRemoteSpaceUrl({spaceName: 'payments', teamName: 'acme', webAppUrl: ''})).to.equal(undefined)
  })

  it('returns undefined when the team name is missing', () => {
    expect(
      buildRemoteSpaceUrl({spaceName: 'payments', teamName: undefined, webAppUrl: 'https://app.byterover.dev'}),
    ).to.equal(undefined)
  })

  it('returns undefined when the space name is missing', () => {
    expect(
      buildRemoteSpaceUrl({spaceName: undefined, teamName: 'acme', webAppUrl: 'https://app.byterover.dev'}),
    ).to.equal(undefined)
  })

  it('returns undefined when either name is an empty string', () => {
    expect(buildRemoteSpaceUrl({spaceName: '', teamName: 'acme', webAppUrl: 'https://app.byterover.dev'})).to.equal(
      undefined,
    )
    expect(buildRemoteSpaceUrl({spaceName: 'payments', teamName: '', webAppUrl: 'https://app.byterover.dev'})).to.equal(
      undefined,
    )
  })

  it('percent-encodes names that contain reserved URL characters', () => {
    expect(
      buildRemoteSpaceUrl({spaceName: 'my space', teamName: 'acme/ops', webAppUrl: 'https://app.byterover.dev'}),
    ).to.equal('https://app.byterover.dev/acme%2Fops/my%20space')
  })
})
