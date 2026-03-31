import {expect} from 'chai'

import {SessionInsightsTracker} from '../../../../../src/server/infra/context-tree/session-insights-tracker.js'

describe('SessionInsightsTracker', () => {
  it('deduplicates recorded paths within a session', () => {
    const tracker = new SessionInsightsTracker()

    tracker.recordSurfacedPaths('session-a', ['auth/context.md', 'auth/context.md', 'auth/_index.md'])

    expect(tracker.drainSession('session-a').sort()).to.deep.equal(['auth/_index.md', 'auth/context.md'])
  })

  it('drainSession returns accumulated paths and clears them', () => {
    const tracker = new SessionInsightsTracker()

    tracker.recordSurfacedPaths('session-a', ['auth/context.md'])

    expect(tracker.drainSession('session-a')).to.deep.equal(['auth/context.md'])
    expect(tracker.drainSession('session-a')).to.deep.equal([])
  })

  it('clearSession removes tracked paths without returning them', () => {
    const tracker = new SessionInsightsTracker()

    tracker.recordSurfacedPaths('session-a', ['auth/context.md'])
    tracker.clearSession('session-a')

    expect(tracker.drainSession('session-a')).to.deep.equal([])
  })

  it('isolates paths across sessions', () => {
    const tracker = new SessionInsightsTracker()

    tracker.recordSurfacedPaths('session-a', ['auth/context.md'])
    tracker.recordSurfacedPaths('session-b', ['experience/lessons/foo.md'])

    expect(tracker.drainSession('session-a')).to.deep.equal(['auth/context.md'])
    expect(tracker.drainSession('session-b')).to.deep.equal(['experience/lessons/foo.md'])
  })
})
