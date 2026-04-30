import {expect} from 'chai'

import {
  AgentEntry,
  agentEntryJsonSchema,
  channelJsonSchemaFiles,
  ChannelMeta,
  channelMetaJsonSchema,
  IncludesConfig,
  includesConfigJsonSchema,
  LookbackPacket,
  lookbackPacketJsonSchema,
  Turn,
  TurnEvent,
  turnEventJsonSchema,
  turnJsonSchema,
} from '../../../../../src/server/core/domain/channel/schemas.js'
import {
  channelMetaFixture,
  includesConfigFixture,
  lookbackPacketFixture,
  mockAgentEntryFixture,
  turnEventFixtures,
  turnFixture,
} from '../../../../helpers/channel-fixtures.js'

describe('channel schemas', () => {
  it('parses all canonical channel fixtures', () => {
    expect(ChannelMeta.parse(channelMetaFixture)).to.deep.equal(channelMetaFixture)
    expect(Turn.parse(turnFixture)).to.deep.equal(turnFixture)
    expect(LookbackPacket.parse(lookbackPacketFixture)).to.deep.equal(lookbackPacketFixture)
    expect(IncludesConfig.parse(includesConfigFixture)).to.deep.equal(includesConfigFixture)
    expect(AgentEntry.parse(mockAgentEntryFixture)).to.deep.equal(mockAgentEntryFixture)

    for (const event of turnEventFixtures) {
      expect(TurnEvent.parse(event)).to.deep.equal(event)
    }
  })

  it('rejects malformed persisted channel data', () => {
    expect(ChannelMeta.safeParse({...channelMetaFixture, status: 'open'}).success).to.equal(false)
    expect(Turn.safeParse({...turnFixture, state: 'done'}).success).to.equal(false)
    expect(TurnEvent.safeParse({content: 'missing role', kind: 'message'}).success).to.equal(false)
    expect(AgentEntry.safeParse({...mockAgentEntryFixture, launch: {host: 'localhost', kind: 'tcp', port: 0}}).success)
      .to.equal(false)
  })

  it('exports named JSON Schemas for every persisted contract', () => {
    const schemas = [
      {name: 'ChannelMeta', schema: channelMetaJsonSchema},
      {name: 'Turn', schema: turnJsonSchema},
      {name: 'TurnEvent', schema: turnEventJsonSchema},
      {name: 'LookbackPacket', schema: lookbackPacketJsonSchema},
      {name: 'IncludesConfig', schema: includesConfigJsonSchema},
      {name: 'AgentEntry', schema: agentEntryJsonSchema},
    ]

    for (const {name, schema} of schemas) {
      expect(schema).to.have.property('$schema')
      expect(schema).to.have.property('definitions')
      expect(schema).to.have.nested.property(`definitions.${name}`)
    }
  })

  it('maps JSON Schemas to stable docs filenames', () => {
    expect(Object.keys(channelJsonSchemaFiles).sort()).to.deep.equal([
      'agent-entry.json',
      'channel-meta.json',
      'includes-config.json',
      'lookback-packet.json',
      'turn-event.json',
      'turn.json',
    ])
    expect(channelJsonSchemaFiles['channel-meta.json']).to.equal(channelMetaJsonSchema)
    expect(channelJsonSchemaFiles['turn.json']).to.equal(turnJsonSchema)
  })
})
