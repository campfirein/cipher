import {expect} from 'chai'

import {ToolName} from '../../../../src/agent/core/domain/tools/constants.js'
import {TOOL_REGISTRY} from '../../../../src/agent/infra/tools/tool-registry.js'

describe('TOOL_REGISTRY', () => {
  it('does not require abstractQueue to register ingest_resource', () => {
    expect(TOOL_REGISTRY[ToolName.INGEST_RESOURCE].requiredServices).to.not.include('abstractQueue')
  })
})
