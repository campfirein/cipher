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
    service = new HubRegistryService(REGISTRY_URL)
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

    it('should cache results on subsequent calls', async () => {
      const scope = nock(REGISTRY_BASE).get(REGISTRY_PATH).once().reply(200, mockRegistryResponse)

      await service.getEntries()
      const result = await service.getEntries()

      expect(result.entries).to.have.lengthOf(2)
      expect(scope.isDone()).to.be.true // Only one HTTP call was made
    })

    it('should throw on timeout', async () => {
      nock(REGISTRY_BASE).get(REGISTRY_PATH).replyWithError({code: 'ECONNABORTED'})

      try {
        await service.getEntries()
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
  })

  describe('getEntryById', () => {
    it('should return matching entry', async () => {
      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(200, mockRegistryResponse)

      const entry = await service.getEntryById('byterover-review')

      expect(entry).to.not.be.undefined
      expect(entry!.id).to.equal('byterover-review')
      expect(entry!.type).to.equal('agent-skill')
    })

    it('should return undefined for unknown entry', async () => {
      nock(REGISTRY_BASE).get(REGISTRY_PATH).reply(200, mockRegistryResponse)

      const entry = await service.getEntryById('nonexistent')

      expect(entry).to.be.undefined
    })
  })
})
