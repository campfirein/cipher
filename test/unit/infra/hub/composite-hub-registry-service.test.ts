/* eslint-disable camelcase */
import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {IHubRegistryService} from '../../../../src/server/core/interfaces/hub/i-hub-registry-service.js'
import type {HubEntryDTO} from '../../../../src/shared/transport/types/dto.js'

import {CompositeHubRegistryService} from '../../../../src/server/infra/hub/composite-hub-registry-service.js'

function createEntry(id: string, registry: string): HubEntryDTO {
  return {
    author: {name: 'Test', url: ''},
    category: 'test',
    dependencies: [],
    description: `${id} description`,
    file_tree: [],
    id,
    license: 'MIT',
    long_description: '',
    manifest_url: '',
    metadata: {use_cases: []},
    name: id,
    path_url: '',
    readme_url: '',
    registry,
    tags: [],
    type: 'agent-skill',
    version: '1.0.0',
  }
}

function createMockRegistry(
  sandbox: SinonSandbox,
  entries: HubEntryDTO[],
  version: string,
): IHubRegistryService {
  return {
    getEntries: sandbox.stub().resolves({entries, version}),
    getEntriesById: sandbox.stub().callsFake(async (entryId: string) => {
      const entry = entries.find((e) => e.id === entryId)
      return entry ? [entry] : []
    }),
    getEntryById: sandbox.stub().callsFake(async (entryId: string) =>
      entries.find((e) => e.id === entryId),
    ),
  }
}

describe('CompositeHubRegistryService', () => {
  let sandbox: SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should throw if no children provided', () => {
    expect(() => new CompositeHubRegistryService([])).to.throw('at least one child')
  })

  describe('getEntries', () => {
    it('should return entries from a single registry', async () => {
      const entries = [createEntry('skill-1', 'official')]
      const child = createMockRegistry(sandbox, entries, '1.0.0')
      const composite = new CompositeHubRegistryService([child])

      const result = await composite.getEntries()

      expect(result.entries).to.have.lengthOf(1)
      expect(result.entries[0].id).to.equal('skill-1')
      expect(result.version).to.equal('1.0.0')
    })

    it('should merge entries from multiple registries', async () => {
      const officialEntries = [createEntry('official-skill', 'official')]
      const privateEntries = [createEntry('private-skill', 'mycompany')]

      const officialChild = createMockRegistry(sandbox, officialEntries, '2.0.0')
      const privateChild = createMockRegistry(sandbox, privateEntries, '1.0.0')
      const composite = new CompositeHubRegistryService([officialChild, privateChild])

      const result = await composite.getEntries()

      expect(result.entries).to.have.lengthOf(2)
      expect(result.entries[0].id).to.equal('official-skill')
      expect(result.entries[1].id).to.equal('private-skill')
    })

    it('should use version from the first (official) registry', async () => {
      const officialChild = createMockRegistry(sandbox, [], '2.5.0')
      const privateChild = createMockRegistry(sandbox, [], '1.0.0')
      const composite = new CompositeHubRegistryService([officialChild, privateChild])

      const result = await composite.getEntries()

      expect(result.version).to.equal('2.5.0')
    })

    it('should skip failed registries and return entries from working ones', async () => {
      const officialEntries = [createEntry('official-skill', 'official')]
      const officialChild = createMockRegistry(sandbox, officialEntries, '1.0.0')

      const failingChild: IHubRegistryService = {
        getEntries: sandbox.stub().rejects(new Error('Network error')),
        getEntriesById: sandbox.stub().rejects(new Error('Network error')),
        getEntryById: sandbox.stub().rejects(new Error('Network error')),
      }

      const composite = new CompositeHubRegistryService([officialChild, failingChild])

      const result = await composite.getEntries()

      expect(result.entries).to.have.lengthOf(1)
      expect(result.entries[0].id).to.equal('official-skill')
    })

    it('should return empty entries if all registries fail', async () => {
      const failingChild: IHubRegistryService = {
        getEntries: sandbox.stub().rejects(new Error('Network error')),
        getEntriesById: sandbox.stub().rejects(new Error('Network error')),
        getEntryById: sandbox.stub().rejects(new Error('Network error')),
      }

      const composite = new CompositeHubRegistryService([failingChild])

      const result = await composite.getEntries()

      expect(result.entries).to.have.lengthOf(0)
      expect(result.version).to.equal('')
    })
  })

  describe('getEntryById', () => {
    it('should find entry from first registry', async () => {
      const officialEntries = [createEntry('skill-1', 'official')]
      const officialChild = createMockRegistry(sandbox, officialEntries, '1.0.0')
      const composite = new CompositeHubRegistryService([officialChild])

      const entry = await composite.getEntryById('skill-1')

      expect(entry).to.not.be.undefined
      expect(entry!.id).to.equal('skill-1')
    })

    it('should find entry from second registry if not in first', async () => {
      const officialChild = createMockRegistry(sandbox, [], '1.0.0')
      const privateEntries = [createEntry('private-skill', 'mycompany')]
      const privateChild = createMockRegistry(sandbox, privateEntries, '1.0.0')
      const composite = new CompositeHubRegistryService([officialChild, privateChild])

      const entry = await composite.getEntryById('private-skill')

      expect(entry).to.not.be.undefined
      expect(entry!.id).to.equal('private-skill')
      expect(entry!.registry).to.equal('mycompany')
    })

    it('should prioritize official registry on ID collision', async () => {
      const officialEntries = [createEntry('shared-id', 'official')]
      const privateEntries = [createEntry('shared-id', 'mycompany')]

      const officialChild = createMockRegistry(sandbox, officialEntries, '1.0.0')
      const privateChild = createMockRegistry(sandbox, privateEntries, '1.0.0')
      const composite = new CompositeHubRegistryService([officialChild, privateChild])

      const entry = await composite.getEntryById('shared-id')

      expect(entry!.registry).to.equal('official')
    })

    it('should return undefined if entry not found in any registry', async () => {
      const officialChild = createMockRegistry(sandbox, [], '1.0.0')
      const composite = new CompositeHubRegistryService([officialChild])

      const entry = await composite.getEntryById('nonexistent')

      expect(entry).to.be.undefined
    })

    it('should skip failed registries during lookup', async () => {
      const failingChild: IHubRegistryService = {
        getEntries: sandbox.stub().rejects(new Error('Network error')),
        getEntriesById: sandbox.stub().rejects(new Error('Network error')),
        getEntryById: sandbox.stub().rejects(new Error('Network error')),
      }

      const privateEntries = [createEntry('private-skill', 'mycompany')]
      const workingChild = createMockRegistry(sandbox, privateEntries, '1.0.0')
      const composite = new CompositeHubRegistryService([failingChild, workingChild])

      const entry = await composite.getEntryById('private-skill')

      expect(entry).to.not.be.undefined
      expect(entry!.id).to.equal('private-skill')
    })
  })

  describe('getEntriesById', () => {
    it('should return empty array when entry not found', async () => {
      const officialChild = createMockRegistry(sandbox, [], '1.0.0')
      const composite = new CompositeHubRegistryService([officialChild])

      const entries = await composite.getEntriesById('nonexistent')

      expect(entries).to.have.lengthOf(0)
    })

    it('should return single match from one registry', async () => {
      const officialEntries = [createEntry('skill-1', 'official')]
      const officialChild = createMockRegistry(sandbox, officialEntries, '1.0.0')
      const composite = new CompositeHubRegistryService([officialChild])

      const entries = await composite.getEntriesById('skill-1')

      expect(entries).to.have.lengthOf(1)
      expect(entries[0].id).to.equal('skill-1')
      expect(entries[0].registry).to.equal('official')
    })

    it('should return multiple matches when ID exists in multiple registries', async () => {
      const officialEntries = [createEntry('shared-id', 'official')]
      const privateEntries = [createEntry('shared-id', 'mycompany')]

      const officialChild = createMockRegistry(sandbox, officialEntries, '1.0.0')
      const privateChild = createMockRegistry(sandbox, privateEntries, '1.0.0')
      const composite = new CompositeHubRegistryService([officialChild, privateChild])

      const entries = await composite.getEntriesById('shared-id')

      expect(entries).to.have.lengthOf(2)
      expect(entries[0].registry).to.equal('official')
      expect(entries[1].registry).to.equal('mycompany')
    })

    it('should skip failed registries', async () => {
      const failingChild: IHubRegistryService = {
        getEntries: sandbox.stub().rejects(new Error('Network error')),
        getEntriesById: sandbox.stub().rejects(new Error('Network error')),
        getEntryById: sandbox.stub().rejects(new Error('Network error')),
      }

      const privateEntries = [createEntry('private-skill', 'mycompany')]
      const workingChild = createMockRegistry(sandbox, privateEntries, '1.0.0')
      const composite = new CompositeHubRegistryService([failingChild, workingChild])

      const entries = await composite.getEntriesById('private-skill')

      expect(entries).to.have.lengthOf(1)
      expect(entries[0].id).to.equal('private-skill')
    })
  })
})
