import {expect} from 'chai'

import type {StatusDTO} from '../../../../../src/shared/transport/types/dto.js'

import {formatStatus} from '../../../../../src/tui/features/status/utils/format-status.js'

// Strip ANSI escape codes so tests can assert on plain text
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replaceAll(/\u001B\[[0-9;]*m/g, '')
}

function makeStatus(overrides: Partial<StatusDTO> = {}): StatusDTO {
  return {
    authStatus: 'logged_in',
    contextTreeStatus: 'no_changes',
    currentDirectory: '/test',
    userEmail: 'user@example.com',
    ...overrides,
  }
}

describe('formatStatus', () => {
  describe('auth status', () => {
    it('should show user email when logged in', () => {
      const output = stripAnsi(formatStatus(makeStatus({authStatus: 'logged_in', userEmail: 'user@example.com'})))
      expect(output).to.include('user@example.com')
    })

    it('should show "Not logged in" when not authenticated', () => {
      const output = stripAnsi(formatStatus(makeStatus({authStatus: 'not_logged_in'})))
      expect(output).to.include('Account: Not logged in')
    })

    it('should show "Session expired" when token is expired', () => {
      const output = stripAnsi(formatStatus(makeStatus({authStatus: 'expired'})))
      expect(output).to.include('Account: Session expired')
    })
  })

  describe('context tree status', () => {
    it('should show "No changes" when context tree has no changes', () => {
      const output = stripAnsi(formatStatus(makeStatus({contextTreeStatus: 'no_changes'})))
      expect(output).to.include('Context Tree: No changes')
    })

    it('should show "Not initialized" when not initialized', () => {
      const output = stripAnsi(formatStatus(makeStatus({contextTreeStatus: 'not_initialized'})))
      expect(output).to.include('Context Tree: Not initialized')
    })

    it('should show git vc message when context tree is Byterover version control', () => {
      const output = stripAnsi(formatStatus(makeStatus({contextTreeStatus: 'git_vc'})))
      expect(output).to.include('Context Tree: Byterover version control')
    })
  })
})
