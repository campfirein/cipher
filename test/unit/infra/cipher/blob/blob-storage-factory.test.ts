import {expect} from 'chai'
import {restore, stub} from 'sinon'

import {createBlobStorage, SqliteBlobStorage} from '../../../../../src/infra/cipher/blob/index.js'

describe('createBlobStorage (Factory)', () => {
  beforeEach(() => {
    // Suppress console output during tests
    stub(console, 'log')
    stub(console, 'error')
  })

  afterEach(() => {
    restore()
  })

  it('should always create SqliteBlobStorage (with inMemory config)', () => {
    const storage = createBlobStorage({inMemory: true})

    expect(storage).to.be.instanceOf(SqliteBlobStorage)
  })

  it('should always create SqliteBlobStorage (with custom config)', () => {
    const storage = createBlobStorage({
      inMemory: true,
      maxBlobSize: 50 * 1024 * 1024,
    })

    expect(storage).to.be.instanceOf(SqliteBlobStorage)
  })

  it('should always create SqliteBlobStorage (default config with inMemory)', () => {
    const storage = createBlobStorage({inMemory: true})

    expect(storage).to.be.instanceOf(SqliteBlobStorage)
  })
})
