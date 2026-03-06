import {expect} from 'chai'
import {restore, stub} from 'sinon'

import {createBlobStorage, FileBlobStorage} from '../../../../src/agent/infra/blob/index.js'

describe('createBlobStorage (Factory)', () => {
  beforeEach(() => {
    // Suppress console output during tests
    stub(console, 'log')
    stub(console, 'error')
  })

  afterEach(() => {
    restore()
  })

  it('should create FileBlobStorage (with inMemory config)', () => {
    const storage = createBlobStorage({inMemory: true})

    expect(storage).to.be.instanceOf(FileBlobStorage)
  })

  it('should create FileBlobStorage (with custom config)', () => {
    const storage = createBlobStorage({
      inMemory: true,
      maxBlobSize: 50 * 1024 * 1024,
    })

    expect(storage).to.be.instanceOf(FileBlobStorage)
  })

  it('should create FileBlobStorage (default config with inMemory)', () => {
    const storage = createBlobStorage({inMemory: true})

    expect(storage).to.be.instanceOf(FileBlobStorage)
  })
})
