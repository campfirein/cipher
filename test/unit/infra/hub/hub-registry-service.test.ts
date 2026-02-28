/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'

import {HubRegistryService} from '../../../../src/server/infra/hub/hub-registry-service.js'

const REGISTRY_BASE = 'https://raw.githubusercontent.com'
const REGISTRY_PATH = '/campfirein/brv-hub/refs/heads/main/registry.json'
const REGISTRY_URL = `${REGISTRY_BASE}${REGISTRY_PATH}`

const mockRegistryResponse = {
  count: 2,
  entries: [
    {
      author: {name: 'ByteRover', url: 'https://byterover.dev'},
      category: 'code-review',
      compatibility: null,
      dependencies: [],
      description: 'Review code changes',
      file_tree: [{name: 'SKILL.md', url: 'https://example.com/SKILL.md'}],
      id: 'byterover-review',
      license: 'MIT',
      long_description: 'Full description',
      manifest_url: 'https://example.com/manifest.json',
      metadata: {use_cases: ['code review']},
      name: 'ByteRover Review',
      path_url: 'https://github.com/campfirein/brv-hub/tree/main/skills/byterover-review',
      readme_url: 'https://example.com/README.md',
      tags: ['review'],
      type: 'agent-skill' as const,
      version: '1.0.0',
    },
    {
      author: {name: 'ByteRover', url: 'https://byterover.dev'},
      category: 'setup',
      compatibility: null,
      dependencies: [],
      description: 'Bootstrap TypeScript projects',
      file_tree: [{name: 'context.md', url: 'https://example.com/context.md'}],
      id: 'typescript-kickstart',
      license: 'MIT',
      long_description: 'Full description',
      manifest_url: 'https://example.com/manifest.json',
      metadata: {use_cases: ['project setup']},
      name: 'TypeScript Kickstart',
      path_url: 'https://github.com/campfirein/brv-hub/tree/main/bundles/typescript-kickstart',
      readme_url: 'https://example.com/README.md',
      tags: ['typescript'],
      type: 'bundle' as const,
      version: '1.0.0',
    },
  ],
  generated_at: '2025-01-01T00:00:00Z',
  version: '1.0.0',
}

describe('HubRegistryService', () => {
  let service: HubRegistryService

  beforeEach(() => {
    service = new HubRegistryService({name: 'official', url: REGISTRY_URL})
  })

  afterEach(() => {
    nock.cleanAll()
  })

  describe('getEntries', () => {
    it('should fetch and return entries from registry', async () => {
      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(200, mockRegistryResponse)

      const result = await service.getEntries()

      expect(result.entries).to.have.lengthOf(2)
      expect(result.version).to.equal('1.0.0')
      expect(result.entries[0].id).to.equal('byterover-review')
      expect(result.entries[1].id).to.equal('typescript-kickstart')
    })

    it('should tag entries with registry name', async () => {
      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(200, mockRegistryResponse)

      const result = await service.getEntries()

      expect(result.entries[0].registry).to.equal('official')
      expect(result.entries[1].registry).to.equal('official')
    })

    it('should tag entries with custom registry name', async () => {
      const customService = new HubRegistryService({name: 'mycompany', url: REGISTRY_URL})
      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(200, mockRegistryResponse)

      const result = await customService.getEntries()

      expect(result.entries[0].registry).to.equal('mycompany')
    })

    it('should cache results on subsequent calls', async () => {
      const scope = nock(REGISTRY_BASE).get(REGISTRY_PATH).once().reply(200, mockRegistryResponse)

      await service.getEntries()
      const result = await service.getEntries()

      expect(result.entries).to.have.lengthOf(2)
      expect(scope.isDone()).to.be.true // Only one HTTP call was made
    })

    it('should throw on timeout', async () => {
      const slowService = new HubRegistryService({name: 'official', timeoutMs: 50, url: REGISTRY_URL})
      nock(REGISTRY_BASE).get(REGISTRY_PATH).delayConnection(200).reply(200, mockRegistryResponse)

      try {
        await slowService.getEntries()
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('timed out')
      }
    })

    it('should throw on network error', async () => {
      nock(REGISTRY_BASE).get(REGISTRY_PATH).replyWithError('getaddrinfo ENOTFOUND raw.githubusercontent.com')

      try {
        await service.getEntries()
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('Unable to reach')
      }
    })

    it('should throw on HTTP error', async () => {
      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(500)

      try {
        await service.getEntries()
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('HTTP 500')
      }
    })

    it('should throw auth error on 401', async () => {
      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(401)

      try {
        await service.getEntries()
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('authentication failed')
      }
    })
  })

  describe('getEntryById', () => {
    it('should return matching entry', async () => {
      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(200, mockRegistryResponse)

      const entry = await service.getEntryById('byterover-review')

      expect(entry).to.not.be.undefined
      expect(entry!.id).to.equal('byterover-review')
      expect(entry!.type).to.equal('agent-skill')
    })

    it('should tag entry with registry name', async () => {
      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(200, mockRegistryResponse)

      const entry = await service.getEntryById('byterover-review')

      expect(entry!.registry).to.equal('official')
    })

    it('should return undefined for unknown entry', async () => {
      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(200, mockRegistryResponse)

      const entry = await service.getEntryById('nonexistent')

      expect(entry).to.be.undefined
    })
  })

  describe('getEntriesById', () => {
    it('should return array with matching entry', async () => {
      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(200, mockRegistryResponse)

      const entries = await service.getEntriesById('byterover-review')

      expect(entries).to.have.lengthOf(1)
      expect(entries[0].id).to.equal('byterover-review')
      expect(entries[0].registry).to.equal('official')
    })

    it('should return empty array for unknown entry', async () => {
      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(200, mockRegistryResponse)

      const entries = await service.getEntriesById('nonexistent')

      expect(entries).to.have.lengthOf(0)
    })
  })

  describe('auth token', () => {
    it('should send Authorization header when authToken is provided', async () => {
      const authedService = new HubRegistryService({authToken: 'my-secret-token', name: 'private', url: REGISTRY_URL})

      nock(REGISTRY_BASE)
        .get(REGISTRY_PATH)
        .matchHeader('authorization', 'Bearer my-secret-token')
        .reply(200, mockRegistryResponse)

      const result = await authedService.getEntries()
      expect(result.entries).to.have.lengthOf(2)
    })

    it('should not send Authorization header when authToken is not provided', async () => {
      nock(REGISTRY_BASE)
        .get(REGISTRY_PATH)
        .reply(function () {
          // Check that no Authorization header was sent
          expect(this.req.headers.authorization).to.be.undefined
          return [200, mockRegistryResponse]
        })

      await service.getEntries()
    })

    it('should send token-prefixed header when authScheme is token', async () => {
      const tokenService = new HubRegistryService({
        authScheme: 'token',
        authToken: 'ghp_abc123',
        name: 'github-private',
        url: REGISTRY_URL,
      })

      nock(REGISTRY_BASE)
        .get(REGISTRY_PATH)
        .matchHeader('authorization', 'token ghp_abc123')
        .reply(200, mockRegistryResponse)

      const result = await tokenService.getEntries()
      expect(result.entries).to.have.lengthOf(2)
    })

    it('should send custom header when authScheme is custom-header', async () => {
      const gitlabService = new HubRegistryService({
        authScheme: 'custom-header',
        authToken: 'glpat-xxx',
        headerName: 'PRIVATE-TOKEN',
        name: 'gitlab',
        url: REGISTRY_URL,
      })

      nock(REGISTRY_BASE)
        .get(REGISTRY_PATH)
        .matchHeader('PRIVATE-TOKEN', 'glpat-xxx')
        .reply(200, mockRegistryResponse)

      const result = await gitlabService.getEntries()
      expect(result.entries).to.have.lengthOf(2)
    })

    it('should send no auth header when authScheme is none', async () => {
      const noneService = new HubRegistryService({
        authScheme: 'none',
        authToken: 'should-be-ignored',
        name: 'public',
        url: REGISTRY_URL,
      })

      nock(REGISTRY_BASE)
        .get(REGISTRY_PATH)
        .reply(function () {
          expect(this.req.headers.authorization).to.be.undefined
          return [200, mockRegistryResponse]
        })

      await noneService.getEntries()
    })
  })

  describe('validation', () => {
    it('should drop invalid entries from registry response', async () => {
      const responseWithInvalidEntry = {
        ...mockRegistryResponse,
        entries: [
          mockRegistryResponse.entries[0],
          {id: 'broken', name: 'Missing fields'},
        ],
      }

      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(200, responseWithInvalidEntry)

      const result = await service.getEntries()

      expect(result.entries).to.have.lengthOf(1)
      expect(result.entries[0].id).to.equal('byterover-review')
    })

    it('should strip extra fields injected by malicious registry', async () => {
      const responseWithExtraFields = {
        ...mockRegistryResponse,
        entries: [
          {
            ...mockRegistryResponse.entries[0],
            malicious_field: '<script>alert("xss")</script>',
            registry: 'official',
          },
        ],
      }

      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(200, responseWithExtraFields)

      const result = await service.getEntries()

      expect(result.entries).to.have.lengthOf(1)
      expect(result.entries[0].registry).to.equal('official')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result.entries[0] as any).malicious_field).to.be.undefined
    })

    it('should override registry field with configured name', async () => {
      const responseWithSpoofedRegistry = {
        ...mockRegistryResponse,
        entries: [
          {
            ...mockRegistryResponse.entries[0],
            registry: 'official',
          },
        ],
      }

      const customService = new HubRegistryService({name: 'mycompany', url: REGISTRY_URL})
      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(200, responseWithSpoofedRegistry)

      const result = await customService.getEntries()

      expect(result.entries[0].registry).to.equal('mycompany')
    })

    it('should throw on completely invalid response structure', async () => {
      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(200, {invalid: true})

      try {
        await service.getEntries()
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('invalid data')
      }
    })

    it('should reject entries with invalid type field', async () => {
      const responseWithBadType = {
        ...mockRegistryResponse,
        entries: [
          {...mockRegistryResponse.entries[0], type: 'malicious-type'},
        ],
      }

      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(200, responseWithBadType)

      const result = await service.getEntries()

      expect(result.entries).to.have.lengthOf(0)
    })
  })
})
