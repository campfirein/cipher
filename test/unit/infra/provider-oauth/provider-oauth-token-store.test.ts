import {expect} from 'chai'
import {randomBytes} from 'node:crypto'
import {type SinonStub, stub} from 'sinon'

import {FileProviderOAuthTokenStore} from '../../../../src/server/infra/provider-oauth/provider-oauth-token-store.js'

const KEY_PATH = '/mock/.provider-oauth-keys'
const CREDENTIALS_PATH = '/mock/provider-oauth-tokens'

function createEnoent(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {code: 'ENOENT'})
}

function createInMemoryFs() {
  const storage = new Map<string, Buffer>()
  const writeData: SinonStub = stub().callsFake(async (path: string, data: Buffer | string): Promise<void> => {
    storage.set(path, typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
  })

  return {
    ensureDir: stub().resolves(),
    readBuffer: stub().callsFake(async (path: string): Promise<Buffer> => {
      const data = storage.get(path)
      if (!data) throw createEnoent(path)
      return data
    }),
    readString: stub().callsFake(async (path: string): Promise<string> => {
      const data = storage.get(path)
      if (!data) throw createEnoent(path)
      return data.toString('utf8')
    }),
    storage,
    writeData,
  }
}

describe('FileProviderOAuthTokenStore', () => {
  let fs: ReturnType<typeof createInMemoryFs>
  let store: FileProviderOAuthTokenStore

  beforeEach(() => {
    fs = createInMemoryFs()
    store = new FileProviderOAuthTokenStore({
      ensureDir: fs.ensureDir,
      getCredentialsPath: () => CREDENTIALS_PATH,
      getDataDir: () => '/mock',
      getKeyPath: () => KEY_PATH,
      readBuffer: fs.readBuffer,
      readString: fs.readString,
      writeData: fs.writeData,
    })
  })

  it('should return undefined for non-existent provider', async () => {
    const result = await store.get('openai')
    expect(result).to.be.undefined
  })

  it('should return false for has() on non-existent provider', async () => {
    const result = await store.has('openai')
    expect(result).to.be.false
  })

  it('should store and retrieve a token record', async () => {
    const record = {expiresAt: '2026-03-15T12:00:00.000Z', refreshToken: 'rt_abc123'}
    await store.set('openai', record)

    const result = await store.get('openai')
    expect(result).to.deep.equal(record)
  })

  it('should return true for has() on existing provider', async () => {
    await store.set('openai', {expiresAt: '2026-03-15T12:00:00.000Z', refreshToken: 'rt_abc123'})

    const result = await store.has('openai')
    expect(result).to.be.true
  })

  it('should store multiple providers independently', async () => {
    const openaiRecord = {expiresAt: '2026-03-15T12:00:00.000Z', refreshToken: 'rt_openai'}
    const anthropicRecord = {expiresAt: '2026-06-01T00:00:00.000Z', refreshToken: 'rt_anthropic'}

    await store.set('openai', openaiRecord)
    await store.set('anthropic', anthropicRecord)

    expect(await store.get('openai')).to.deep.equal(openaiRecord)
    expect(await store.get('anthropic')).to.deep.equal(anthropicRecord)
  })

  it('should overwrite existing record for same provider', async () => {
    await store.set('openai', {expiresAt: '2026-03-15T12:00:00.000Z', refreshToken: 'rt_old'})
    await store.set('openai', {expiresAt: '2026-06-01T00:00:00.000Z', refreshToken: 'rt_new'})

    const result = await store.get('openai')
    expect(result?.refreshToken).to.equal('rt_new')
    expect(result?.expiresAt).to.equal('2026-06-01T00:00:00.000Z')
  })

  it('should delete a token record', async () => {
    await store.set('openai', {expiresAt: '2026-03-15T12:00:00.000Z', refreshToken: 'rt_abc123'})
    await store.delete('openai')

    expect(await store.get('openai')).to.be.undefined
    expect(await store.has('openai')).to.be.false
  })

  it('should not fail when deleting non-existent provider', async () => {
    await store.delete('nonexistent')
    // Should not throw
  })

  it('should not affect other providers when deleting', async () => {
    await store.set('openai', {expiresAt: '2026-03-15T12:00:00.000Z', refreshToken: 'rt_openai'})
    await store.set('anthropic', {expiresAt: '2026-06-01T00:00:00.000Z', refreshToken: 'rt_anthropic'})

    await store.delete('openai')

    expect(await store.get('openai')).to.be.undefined
    expect(await store.get('anthropic')).to.deep.equal({
      expiresAt: '2026-06-01T00:00:00.000Z',
      refreshToken: 'rt_anthropic',
    })
  })

  it('should encrypt data (not stored as plaintext)', async () => {
    await store.set('openai', {expiresAt: '2026-03-15T12:00:00.000Z', refreshToken: 'rt_secret_token'})

    // Verify the credentials written to storage are encrypted
    const credentialsData = fs.storage.get(CREDENTIALS_PATH)!.toString('utf8')
    expect(credentialsData).to.not.include('rt_secret_token')
    expect(credentialsData).to.not.include('openai')
    // Encrypted format: iv:authTag:data (base64)
    expect(credentialsData.split(':')).to.have.lengthOf(3)
  })

  it('should write files with 0600 permissions', async () => {
    await store.set('openai', {expiresAt: '2026-03-15T12:00:00.000Z', refreshToken: 'rt_abc123'})

    // writeData is called twice: once for key file, once for credentials file
    const keyCall = fs.writeData.getCalls().find((c) => c.args[0] === KEY_PATH)
    const credCall = fs.writeData.getCalls().find((c) => c.args[0] === CREDENTIALS_PATH)

    expect(keyCall?.args[2]).to.deep.include({mode: 0o600})
    expect(credCall?.args[2]).to.deep.include({mode: 0o600})
  })

  it('should handle corrupt credentials file gracefully on get', async () => {
    // Pre-populate with valid key but corrupt credentials
    fs.storage.set(KEY_PATH, randomBytes(32))
    fs.storage.set(CREDENTIALS_PATH, Buffer.from('not-valid-encrypted-data'))

    const result = await store.get('openai')
    expect(result).to.be.undefined
  })

  it('should overwrite corrupt file on set', async () => {
    // Pre-populate with corrupt data
    fs.storage.set(KEY_PATH, randomBytes(32))
    fs.storage.set(CREDENTIALS_PATH, Buffer.from('corrupt-data'))

    // Should succeed and overwrite
    await store.set('openai', {expiresAt: '2026-03-15T12:00:00.000Z', refreshToken: 'rt_fresh'})

    const result = await store.get('openai')
    expect(result?.refreshToken).to.equal('rt_fresh')
  })
})
