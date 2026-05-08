 
import {expect} from 'chai'

import {type AnalyticsEventName, AnalyticsEventNames} from '../../../../src/shared/analytics/event-names.js'

describe('AnalyticsEventNames', () => {
  it('should expose exactly the seven shipped event names', () => {
    expect(Object.keys(AnalyticsEventNames).sort()).to.deep.equal([
      'CLI_INVOCATION',
      'DAEMON_START',
      'MCP_SESSION_START',
      'MCP_TOOL_CALLED',
      'TASK_COMPLETED',
      'TASK_CREATED',
      'TASK_FAILED',
    ])
  })

  it('should map each key to a snake_case wire string', () => {
    expect(AnalyticsEventNames.DAEMON_START).to.equal('daemon_start')
    expect(AnalyticsEventNames.CLI_INVOCATION).to.equal('cli_invocation')
    expect(AnalyticsEventNames.MCP_SESSION_START).to.equal('mcp_session_start')
    expect(AnalyticsEventNames.MCP_TOOL_CALLED).to.equal('mcp_tool_called')
    expect(AnalyticsEventNames.TASK_CREATED).to.equal('task_created')
    expect(AnalyticsEventNames.TASK_COMPLETED).to.equal('task_completed')
    expect(AnalyticsEventNames.TASK_FAILED).to.equal('task_failed')
  })

  it('should expose AnalyticsEventName as the union of values', () => {
    const sample: AnalyticsEventName = AnalyticsEventNames.DAEMON_START
    expect(sample).to.equal('daemon_start')
  })
})
