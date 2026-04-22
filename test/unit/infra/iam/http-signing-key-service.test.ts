/**
 * HttpSigningKeyService Unit Tests
 */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {IHttpClient} from '../../../../src/server/core/interfaces/services/i-http-client.js'

import {VcError} from '../../../../src/server/core/domain/errors/vc-error.js'
import {HttpSigningKeyService} from '../../../../src/server/infra/iam/http-signing-key-service.js'
import {VcErrorCode} from '../../../../src/shared/transport/events/vc-events.js'

type Stubbed<T> = {[K in keyof T]: SinonStub & T[K]}

const IAM_BASE_URL = 'https://iam.example.com'
const KEYS_PATH = '/api/v3/users/me/signing-keys'

/* eslint-disable camelcase */
const RAW_KEY = {
  created_at: '2024-01-01T00:00:00Z',
  fingerprint: 'SHA256:abc123',
  id: 'key-id-1',
  key_type: 'ssh-ed25519',
  public_key: 'ssh-ed25519 AAAA... test@example.com',
  title: 'My laptop',
}
/* eslint-enable camelcase */

describe('HttpSigningKeyService', () => {
  let sandbox: SinonSandbox
  let httpClient: Stubbed<IHttpClient>
  let service: HttpSigningKeyService

  beforeEach(() => {
    sandbox = createSandbox()
    httpClient = {
      delete: sandbox.stub().resolves(),
      get: sandbox.stub(),
      post: sandbox.stub(),
      put: sandbox.stub().resolves(),
    }
    service = new HttpSigningKeyService(httpClient as unknown as IHttpClient, IAM_BASE_URL)
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('addKey()', () => {
    it('POSTs to the signing-keys endpoint with snake_case body', async () => {
      httpClient.post.resolves({
        data: {signing_key: RAW_KEY}, // eslint-disable-line camelcase
        success: true,
      })

      await service.addKey('My laptop', 'ssh-ed25519 AAAA...')

      expect(httpClient.post.calledOnce).to.be.true
      const [url, body] = httpClient.post.firstCall.args
      expect(url).to.equal(`${IAM_BASE_URL}${KEYS_PATH}`)
      expect(body).to.deep.equal({
        public_key: 'ssh-ed25519 AAAA...', // eslint-disable-line camelcase
        title: 'My laptop',
      })
    })

    it('maps snake_case API response to camelCase SigningKeyResource', async () => {
      httpClient.post.resolves({
        data: {signing_key: RAW_KEY}, // eslint-disable-line camelcase
        success: true,
      })

      const result = await service.addKey('My laptop', 'ssh-ed25519 AAAA...')

      expect(result).to.deep.equal({
        createdAt: '2024-01-01T00:00:00Z',
        fingerprint: 'SHA256:abc123',
        id: 'key-id-1',
        keyType: 'ssh-ed25519',
        lastUsedAt: undefined,
        publicKey: 'ssh-ed25519 AAAA... test@example.com',
        title: 'My laptop',
      })
    })

    // Regression test for PR #435 review comment #19: dup-detection at the
    // CLI used to sniff four different English substrings on the error
    // message. The IAM server already communicates duplicate intent via HTTP
    // 409; the HTTP adapter is the right layer to translate that into a
    // structured VcError whose code the CLI can match exactly.
    it('throws VcError SIGNING_KEY_ALREADY_EXISTS when underlying client reports HTTP 409', async () => {
      httpClient.post.rejects(new Error('HTTP 409: Conflict'))

      let caught: unknown
      try {
        await service.addKey('My laptop', 'ssh-ed25519 AAAA...')
      } catch (error) {
        caught = error
      }

      expect(caught).to.be.instanceOf(VcError)
      if (caught instanceof VcError) {
        expect(caught.code).to.equal(VcErrorCode.SIGNING_KEY_ALREADY_EXISTS)
      }
    })

    it('passes through other HTTP errors unchanged', async () => {
      const original = new Error('HTTP 500: Internal Server Error')
      httpClient.post.rejects(original)

      let caught: unknown
      try {
        await service.addKey('My laptop', 'ssh-ed25519 AAAA...')
      } catch (error) {
        caught = error
      }

      expect(caught).to.equal(original)
    })
  })

  describe('listKeys()', () => {
    it('GETs from the signing-keys endpoint', async () => {
      httpClient.get.resolves({
        data: {signing_keys: [RAW_KEY]}, // eslint-disable-line camelcase
        success: true,
      })

      await service.listKeys()

      expect(httpClient.get.calledOnce).to.be.true
      expect(httpClient.get.firstCall.args[0]).to.equal(`${IAM_BASE_URL}${KEYS_PATH}`)
    })

    it('maps each key from snake_case to camelCase', async () => {
      httpClient.get.resolves({
        data: {signing_keys: [RAW_KEY]}, // eslint-disable-line camelcase
        success: true,
      })

      const keys = await service.listKeys()

      expect(keys).to.have.length(1)
      expect(keys[0]).to.include({fingerprint: 'SHA256:abc123', keyType: 'ssh-ed25519'})
    })

    it('returns empty array when signing_keys field is missing', async () => {
      httpClient.get.resolves({
        data: {},
        success: true,
      })

      const keys = await service.listKeys()

      expect(keys).to.deep.equal([])
    })

    // Regression test for PR #435 review comment #20: even though
    // AuthenticatedHttpClient throws on non-2xx responses, a 200 OK with
    // `{success: false}` would previously slip past listKeys unnoticed and
    // return []. Callers had no way to distinguish "no keys" from "request
    // silently failed". Surface that state as an explicit throw.
    it('throws when response envelope reports success:false', async () => {
      httpClient.get.resolves({
        data: {signing_keys: []}, // eslint-disable-line camelcase
        success: false,
      })

      let caught: unknown
      try {
        await service.listKeys()
      } catch (error) {
        caught = error
      }

      expect(caught).to.be.instanceOf(Error)
    })
  })

  describe('removeKey()', () => {
    it('DELETEs to the signing-keys/{id} endpoint', async () => {
      await service.removeKey('key-id-1')

      expect(httpClient.delete.calledOnce).to.be.true
      expect(httpClient.delete.firstCall.args[0]).to.equal(`${IAM_BASE_URL}${KEYS_PATH}/key-id-1`)
    })
  })

  describe('URL construction', () => {
    it('strips trailing slash from base URL', () => {
      const svc = new HttpSigningKeyService(httpClient as unknown as IHttpClient, 'https://iam.example.com/')
      httpClient.get.resolves({data: {signing_keys: []}, success: true}) // eslint-disable-line camelcase
      svc.listKeys()
      expect(httpClient.get.firstCall.args[0]).to.equal(`https://iam.example.com${KEYS_PATH}`)
    })
  })
})
