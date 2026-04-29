import {expect} from 'chai'

import {useComposerRetryStore} from '../../../../../../src/webui/features/tasks/stores/composer-retry-store.js'

describe('useComposerRetryStore', () => {
  beforeEach(() => {
    useComposerRetryStore.setState({seed: null})
  })

  it('starts with a null seed', () => {
    expect(useComposerRetryStore.getState().seed).to.equal(null)
  })

  it('records the latest seed via requestRetry', () => {
    useComposerRetryStore.getState().requestRetry({content: 'list conventions', type: 'curate'})
    expect(useComposerRetryStore.getState().seed).to.deep.equal({content: 'list conventions', type: 'curate'})
  })

  it('overwrites the previous seed when requestRetry is called again', () => {
    useComposerRetryStore.getState().requestRetry({content: 'first', type: 'curate'})
    useComposerRetryStore.getState().requestRetry({content: 'second', type: 'query'})
    expect(useComposerRetryStore.getState().seed).to.deep.equal({content: 'second', type: 'query'})
  })

  it('consume returns the seed and clears it', () => {
    useComposerRetryStore.getState().requestRetry({content: 'hi', type: 'query'})
    const taken = useComposerRetryStore.getState().consume()
    expect(taken).to.deep.equal({content: 'hi', type: 'query'})
    expect(useComposerRetryStore.getState().seed).to.equal(null)
  })

  it('consume returns null and is a no-op when there is no pending seed', () => {
    expect(useComposerRetryStore.getState().consume()).to.equal(null)
    expect(useComposerRetryStore.getState().seed).to.equal(null)
  })
})
