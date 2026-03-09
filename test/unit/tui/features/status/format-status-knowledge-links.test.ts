/**
 * Unit tests for knowledge link display in formatStatus().
 */

import {expect} from 'chai'

import type {StatusDTO} from '../../../../../src/shared/transport/types/dto.js'

import {formatStatus} from '../../../../../src/tui/features/status/utils/format-status.js'

describe('formatStatus knowledge links', () => {
  const baseStatus: StatusDTO = {
    authStatus: 'logged_in',
    contextTreeStatus: 'no_changes',
    currentDirectory: '/test',
    projectRoot: '/test',
    userEmail: 'test@example.com',
  }

  it('should show knowledge links section when links exist', () => {
    const status: StatusDTO = {
      ...baseStatus,
      knowledgeLinks: [
        {alias: 'shared-lib', contextTreeSize: 42, projectRoot: '/path/to/shared-lib', valid: true},
      ],
    }

    const output = formatStatus(status, '1.0.0')
    expect(output).to.include('Knowledge Links:')
    expect(output).to.include('shared-lib')
    expect(output).to.include('/path/to/shared-lib')
    expect(output).to.include('(valid)')
    expect(output).to.include('[42 files]')
  })

  it('should show BROKEN status with actionable hint for invalid links', () => {
    const status: StatusDTO = {
      ...baseStatus,
      knowledgeLinks: [
        {alias: 'gone-project', projectRoot: '/nonexistent', valid: false},
      ],
    }

    const output = formatStatus(status, '1.0.0')
    expect(output).to.include('Knowledge Links:')
    expect(output).to.include('gone-project')
    expect(output).to.include('BROKEN')
    expect(output).to.include('brv unlink-knowledge gone-project')
  })

  it('should not show knowledge links section when no links', () => {
    const output = formatStatus(baseStatus, '1.0.0')
    expect(output).to.not.include('Knowledge Links:')
  })

  it('should not show knowledge links section for empty array', () => {
    const status: StatusDTO = {
      ...baseStatus,
      knowledgeLinks: [],
    }

    const output = formatStatus(status, '1.0.0')
    expect(output).to.not.include('Knowledge Links:')
  })

  it('should show multiple links', () => {
    const status: StatusDTO = {
      ...baseStatus,
      knowledgeLinks: [
        {alias: 'lib-a', projectRoot: '/path/a', valid: true},
        {alias: 'lib-b', projectRoot: '/path/b', valid: false},
      ],
    }

    const output = formatStatus(status, '1.0.0')
    expect(output).to.include('lib-a')
    expect(output).to.include('lib-b')
  })
})
